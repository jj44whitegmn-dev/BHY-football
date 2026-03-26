/* ============================================================
   vision.js — Claude Vision API 图片识别模块
   调用 Claude Haiku 识别澳客截图中的亚盘赔率数据
   支持开盘截图（提取初盘数据）和临盘截图（提取终盘数据+S5）
   ============================================================ */

const Vision = (() => {

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-haiku-4-5-20251001';

  const LINE_RULES = `盘口中文→数字转换规则：
- 平手=0
- 平/半（主让）=-0.25，半球（主让）=-0.5，半/一（主让）=-0.75
- 一球（主让）=-1，一/球半或一球/球半（主让）=-1.25，球半（主让）=-1.5
- 两球（主让）=-2
- 平/半（客让）=0.25，半球（客让）=0.5，半/一（客让）=0.75，一球（客让）=1
负数=主队让球，正数=客队让球。`;

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
    const prompt = `这是澳客App"盘口详情页-盘口变化"的开盘截图，显示${hint}的亚盘赔率早期变化。
页面结构：左列=主队水位，中列=盘口，右列=客队水位；时间从上（最早）到下（最新）。
任务：找到最早期的那一行（通常标注"初始盘口"，或时间最靠前的行），提取数据。
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
    const prompt = `这是澳客App"盘口详情页-盘口变化"的临盘截图，显示${hint}的亚盘赔率临近开赛前的变化。
页面结构：左列=主队水位，中列=盘口，右列=客队水位；时间从上到下，最下方（"赛前0小时0分"或最小时间）是终盘。
任务1：找到最新（最靠近赛前）那行，提取终盘数据。
任务2：分析截图中的所有行，判断S5降盘异常。
返回如下JSON，不要任何其他文字：
{
  "close_line": 终盘盘口数值（数字），
  "close_home": 终盘主队水位（数字），
  "close_away": 终盘客队水位（数字），
  "s5": 降盘异常（整数）
}
${LINE_RULES}
S5降盘异常判断：
- 扫描所有行的盘口列，找是否存在"先降后升"（即盘口先朝某方向大幅移动≥0.5球，再反向回升≥0.5球）
- 如有，且最终（终盘）盘口相比最低点更偏主队方向 → s5=1（偏主）
- 如有，且最终盘口相比最低点更偏客队方向 → s5=-1（偏客）
- 无明显降后回升 → s5=0
无法识别的字段填null。`;
    return callAPI(imageFile, prompt);
  }

  return { recognizeOpening, recognizeClosing };
})();
