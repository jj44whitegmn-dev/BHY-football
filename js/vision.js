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

    const prompt = `这是${hint}的亚盘赔率截图，来自澳客手机App的赔率变化页面。
请识别图中的亚盘数据，严格以如下JSON格式返回，不要任何其他文字：
{
  "open_line": 初盘盘口数值（数字：-0.5=主让半球，0=平手，0.25=平/半客，null=无法识别），
  "open_home": 初盘主队水位（数字如1.925，null=无法识别），
  "open_away": 初盘客队水位（数字如1.925，null=无法识别），
  "close_line": 终盘盘口（数字，无则null），
  "close_home": 终盘主队水位（数字，无则null），
  "close_away": 终盘客队水位（数字，无则null）
}
盘口规则：负数=主队让球，正数=客队让球，0=平手，0.25=平半（客让）。
水位通常在0.8~1.0之间或欧赔1.5~3.0之间，请注意区分。`;

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
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
