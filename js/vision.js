/* ============================================================
   vision.js — Claude Vision API 图片识别模块
   调用 Claude Haiku 识别澳客截图中的亚盘赔率数据
   支持开盘截图（提取初盘数据）和临盘截图（提取终盘数据+S5）
   ============================================================ */

const Vision = (() => {

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-haiku-4-5-20251001';

  const LINE_RULES = `【澳客盘口方向规则——必须严格遵守】
澳客的盘口列用"受"字区分让球方向：
- 无"受"字：一球、半球、球半、平/半、半/一、一/球半 → 主队让球 → 转为【负数】
  一球=-1，半球=-0.5，球半=-1.5，平/半=-0.25，半/一=-0.75，一/球半=-1.25，两球=-2
- 有"受"字：受一球、受半球、受球半 → 客队让球 → 转为【正数】
  受半球=+0.5，受一球=+1，受球半=+1.5，受平/半=+0.25
- 平手=0

例：截图盘口列写"一球" → 无受字 → 主让 → -1
例：截图盘口列写"受半球" → 有受字 → 客让 → +0.5`;

  function getKey() {
    return (Storage.Settings.get().claude_api_key || '').trim();
  }

  async function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function callAPI(imageFile, prompt) {
    const key = getKey();
    if (!key) throw new Error('请先在设置页填入 Claude API Key');

    const base64    = await toBase64(imageFile);
    const mediaType = imageFile.type.startsWith('image/') ? imageFile.type : 'image/jpeg';

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!resp.ok) {
      let msg = `API错误 ${resp.status}`;
      try { const e = await resp.json(); msg = e.error?.message || msg; } catch {}
      throw new Error(msg);
    }

    const data = await resp.json();
    const text = (data.content?.[0]?.text || '').trim();
    const m    = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('识别结果格式异常，请重试');
    return JSON.parse(m[0]);
  }

  /**
   * recognizeOpening(imageFile, company)
   * 开盘截图：提取初盘（最早期）的盘口和水位数据
   * 适用于：截图包含开盘初期数据（有"初始盘口"行）
   */
  async function recognizeOpening(imageFile, company) {
    const hint = company === 'pinnacle' ? '平博（Pinnacle）' : '威廉希尔（William Hill）';
    const prompt = `这是澳客App"盘口详情页-盘口变化"截图，显示${hint}的亚盘赔率变化。
【澳客固定页面结构】：
- 第一行右侧标注"初始盘口"，是开盘时的第一个赔率（无时间戳）
- 其余行右侧有"赛前X小时Y分"时间戳，按从新到旧排列（赛前小时数越小越新）

任务：提取标注"初始盘口"的那一行数据。
返回如下JSON，不要任何其他文字：
{
  "open_line": 初盘盘口数值（数字），
  "open_home": 初盘主队水位（数字），
  "open_away": 初盘客队水位（数字）
}
${LINE_RULES}
无法识别的字段填null。`;
    return callAPI(imageFile, prompt);
  }

  /**
   * recognizeClosing(imageFile, company)
   * 临盘截图：提取终盘（最靠近开赛）的数据，并判断S5降盘异常
   * 适用于：截图包含赛前最新数据
   */
  async function recognizeClosing(imageFile, company) {
    const hint = company === 'pinnacle' ? '平博（Pinnacle）' : '威廉希尔（William Hill）';
    const prompt = `这是澳客App"盘口详情页-盘口变化"截图，显示${hint}的亚盘赔率变化。
【澳客固定页面结构】：
- 第一行右侧标注"初始盘口"，是开盘时的第一个赔率
- 其余行右侧有"赛前X小时Y分"时间戳，从上到下按从新到旧排列（顶部=最新=赛前小时数最小）

任务1（提取终盘）：
- 跳过"初始盘口"行
- 在其余行中，找赛前时间最小的那一行（最靠近开赛），取其主水/盘口/客水作为终盘
- 当前截图中，赛前时间最小的行就是紧跟在"初始盘口"下面的第一个有时间戳的行

任务2（S5降盘异常）：
- 将所有有时间戳的行（跳过初始盘口）按时间从旧到新排序，逐行读取盘口数值
- 如果盘口数值先向某方向移动≥0.5球、之后又反向回移≥0.5球，为降盘异常
- 终盘盘口比最低点更偏主队（更负）→ s5=1；更偏客队（更正）→ s5=-1；无异常 → s5=0

返回如下JSON，不要任何其他文字：
{
  "close_line": 终盘盘口数值（数字），
  "close_home": 终盘主队水位（数字），
  "close_away": 终盘客队水位（数字），
  "s5": 降盘异常（整数）
}
${LINE_RULES}
无法识别的字段填null。`;
    return callAPI(imageFile, prompt);
  }

  return { recognizeOpening, recognizeClosing };
})();
