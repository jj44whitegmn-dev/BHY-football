/* ============================================================
   vision.js — Claude Vision API 图片识别模块
   调用 Claude Haiku 识别澳客截图中的亚盘赔率数据
   支持开盘截图（提取初盘数据）和临盘截图（提取终盘数据+S5）
   ============================================================ */

const Vision = (() => {

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-haiku-4-5-20251001';

  const LINE_RULES = `盘口数字转换规则（中文→数字）：
平手=0，半球=0.5，一球=1，球半=1.5，两球=2
平/半=0.25，半/一=0.75，一/球半=1.25，一球/球半=1.25

【方向判断——最关键】澳客盘口列通常只写数量不写方向（如"一球"不写"主让/客让"）：
→ 必须用水位列来判断方向：
  - 主队水位（左列）数字 < 客队水位（右列）数字：主队是热门 → 主队让球 → 盘口取负值（如一球=-1）
  - 客队水位（右列）数字 < 主队水位（左列）数字：客队是热门 → 客队让球 → 盘口取正值（如一球=+1）
  - 例：主水1.63，客水2.29，主队热门，"一球"= -1（主让一球）
  - 例：主水2.10，客水1.75，客队热门，"一球"= +1（客让一球）`;

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
    const prompt = `这是澳客App"盘口详情页-盘口变化"截图，显示${hint}的亚盘赔率变化历史。
页面结构：左列=主队水位，中列=盘口，右列=客队水位，右侧=时间（赛前X小时Y分）。
时间方向说明：澳客通常最新（时间小的）在上、最旧（时间大的）在下，也可能相反；请根据实际时间数字判断。
任务：在所有可见行中，找到时间最大（赛前最多小时）的那一行，即最早开盘的数据，提取为初盘。
如有"初始盘口"标签则直接用那行。
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
页面结构：左列=主队水位，中列=盘口，右列=客队水位，右侧=时间（赛前X小时Y分）。
时间方向说明：澳客通常最新（时间小的）在上、最旧（时间大的）在下，也可能相反；请根据实际时间数字判断。
任务1：找到时间最小（赛前最少小时/分）的那一行，即最接近开赛的终盘数据。
任务2：分析截图中所有行的盘口变化，判断S5降盘异常。
返回如下JSON，不要任何其他文字：
{
  "close_line": 终盘盘口数值（数字），
  "close_home": 终盘主队水位（数字），
  "close_away": 终盘客队水位（数字），
  "s5": 降盘异常（整数）
}
${LINE_RULES}
S5降盘异常判断（基于盘口数值的变化序列）：
- 将所有行的盘口转为数字（按上方规则），按时间从旧到新排列
- 如存在：某段先朝一个方向移动≥0.5球，然后又反向回移≥0.5球（即明显降后回升）
- 回升后终盘比最低点更偏主队（数值更小/更负）→ s5=1
- 回升后终盘比最低点更偏客队（数值更大/更正）→ s5=-1
- 无明显异常 → s5=0
无法识别的字段填null。`;
    return callAPI(imageFile, prompt);
  }

  return { recognizeOpening, recognizeClosing };
})();
