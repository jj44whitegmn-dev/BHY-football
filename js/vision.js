/* ============================================================
   vision.js — Claude Vision API 图片识别模块
   调用 Claude Haiku 识别澳客截图中的亚盘赔率数据
   ============================================================ */

const Vision = (() => {

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-haiku-4-5-20251001';

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

  /**
   * recognizeAsian(imageFile, company)
   * company: 'pinnacle' | 'william_hill'
   *
   * 返回对象：
   * {
   *   open_line, open_home, open_away,       // 初盘：盘口/主水/客水
   *   close_line, close_home, close_away,    // 终盘（平博有，威廉希尔可为null）
   * }
   * 无法识别的字段为 null。
   */
  async function recognizeAsian(imageFile, company) {
    const key = getKey();
    if (!key) throw new Error('请先在设置页填入 Claude API Key');

    const base64    = await toBase64(imageFile);
    const mediaType = imageFile.type.startsWith('image/') ? imageFile.type : 'image/jpeg';
    const hint      = company === 'pinnacle' ? '平博（Pinnacle）' : '威廉希尔（William Hill）';

    const prompt = `这是澳客手机App"盘口详情页-盘口变化"的截图，显示${hint}的亚盘赔率随时间变化。
页面结构：左列=主队水位，中列=盘口，右列=客队水位；时间轴从上到下，最顶部一行标注"初始盘口"，最靠近赛前的行（最新行，通常标注"赛前0小时0分"或最小时间）是终盘。
请识别并返回如下JSON，不要任何其他文字：
{
  "open_line": 初盘盘口数值（数字，规则如下），
  "open_home": 初盘主队水位（数字），
  "open_away": 初盘客队水位（数字），
  "close_line": 终盘盘口（即最新/最靠近赛前的那行），
  "close_home": 终盘主队水位，
  "close_away": 终盘客队水位
}
盘口转换规则（中文→数字）：
- 平手=0，平/半（主让）=-0.25，半球（主让）=-0.5，半/一（主让）=-0.75
- 一球（主让）=-1，一/球半（主让）=-1.25，球半（主让）=-1.5
- 平/半（客让）=0.25，半球（客让）=0.5，半/一（客让）=0.75，一球（客让）=1
- "一球/球半"="一/球半"=-1.25（主让1.25球）
无法识别的字段填null。`;

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
        max_tokens: 300,
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
    const m    = text.match(/\{[\s\S]*?\}/);
    if (!m) throw new Error('识别结果格式异常，请重试');

    return JSON.parse(m[0]);
  }

  return { recognizeAsian };
})();
