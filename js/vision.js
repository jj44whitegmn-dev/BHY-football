/* ============================================================
   vision.js — Claude Vision API 图片识别模块
   调用 Claude Haiku 识别澳客截图中的亚盘赔率数据

   澳客页面有两种截图状态：
   【开盘截图】无"初始盘口"标签，所有行均有时间戳，最新在上最旧在下
              → 取最下方那行（赛前小时数最大）= 初盘数据
   【临盘截图】顶部有"初始盘口"标签行（无时间戳），其后最新行紧跟其下
              → 取"初始盘口"下方第一个有时间戳的行 = 终盘数据
   ============================================================ */

const Vision = (() => {

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL   = 'claude-sonnet-4-6';

  const LINE_RULES = `【列数据类型——必须严格区分，这是最常见的错误来源】
页面共三列数据：
- 左列（主）：纯小数，如1.89、1.71——这是主队赔率水位
- 中列（盘）：纯中文文字，如"一球"、"受半球"、"平手"——绝对不是小数！
- 右列（客）：纯小数，如1.96、2.22——这是客队赔率水位

⚠️ 如果你在中列（盘口）看到1.96、2.29之类的小数，说明你认错列了！盘口列永远是中文文字。
请重新对齐：找到值为中文文字（一球/受半球/平手等）的那列才是盘口列。

【盘口中文→数字转换】
无"受"字 → 主让 → 负数：一球=-1，半球=-0.5，球半=-1.5，平/半=-0.25，半/一=-0.75，一/球半=-1.25，两球=-2
有"受"字 → 客让 → 正数：受半球=+0.5，受一球=+1，受球半=+1.5，受平/半=+0.25
平手=0`;

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
        max_tokens: 800,
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
    const raw  = (data.content?.[0]?.text || '').trim();

    // 依次尝试解析：代码块JSON → 裸JSON → 宽松提取
    function tryParse(str) {
      // 1. markdown 代码块
      let m = str.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (m) { try { return JSON.parse(m[1]); } catch {} }
      // 2. 裸 JSON 对象（贪婪匹配最外层花括号）
      m = str.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch {} }
      // 3. 控制字符清洗后再试
      if (m) { try { return JSON.parse(m[0].replace(/[\x00-\x1F\x7F]/g, ' ')); } catch {} }
      return null;
    }

    const result = tryParse(raw);
    if (!result) throw new Error('识别结果格式异常，请重试');
    return result;
  }

  /**
   * recognizeOpening(imageFile, company)
   * 开盘截图识别：提取初盘数据
   *
   * 澳客开盘截图特征：
   * - 页面无"初始盘口"文字标签
   * - 所有行右侧均为"赛前X小时Y分"时间戳
   * - 排列顺序：最新在上（赛前小时数小）→ 最旧在下（赛前小时数大）
   * - 初盘 = 最下方那行（赛前小时数最大的行）
   */
  async function recognizeOpening(imageFile, company) {
    const hint = company === 'pinnacle' ? '平博（Pinnacle）' : '威廉希尔（William Hill）';
    const prompt = `这是澳客App"盘口详情页-盘口变化"的开盘截图，显示${hint}的亚盘赔率历史。
列结构：左=主队水位，中=盘口，右=客队水位，最右=时间戳。

此截图特征：所有行右侧均为"赛前X小时Y分"格式，无"初始盘口"文字标签。
时间排列：最新在上（赛前小时数小），最旧在下（赛前小时数大）。

任务：读取每行的时间戳，找到赛前小时数最大的那一行（最底部可见行），提取为初盘数据。
例：赛前671小时56分 > 赛前148小时35分，取赛前671小时56分那行。

返回JSON，不要其他文字：
{"open_line":初盘盘口数值,"open_home":初盘主队水位,"open_away":初盘客队水位}

${LINE_RULES}
无法识别填null。`;
    return callAPI(imageFile, prompt);
  }

  /**
   * recognizeClosing(imageFile, company)
   * 临盘截图识别：提取终盘数据 + S5判断
   *
   * 澳客临盘截图特征：
   * - 顶部第一行右侧标注"初始盘口"（无时间戳，是开盘参考行）
   * - 第二行起有"赛前X小时Y分"时间戳，最新的紧跟在"初始盘口"下方
   * - 终盘 = 紧跟"初始盘口"之后、时间戳中赛前小时数最小的那行
   */
  async function recognizeClosing(imageFile, company) {
    const hint = company === 'pinnacle' ? '平博（Pinnacle）' : '威廉希尔（William Hill）';
    const prompt = `这是澳客App"盘口详情页-盘口变化"的临盘截图，显示${hint}的亚盘赔率变化。
列结构：左=主队水位，中=盘口，右=客队水位，最右=时间戳或"初始盘口"文字。

此截图特征：顶部第一行右侧为"初始盘口"文字（无时间数字），其余行有"赛前X小时Y分"时间戳。
时间排列：初始盘口行下方，赛前小时数最小的行=最新=终盘。

任务1（终盘）：
- 跳过"初始盘口"行
- 在有时间戳的行中，找赛前小时数最小的那行（最新数据）作为终盘

任务2（S5降盘异常）：
- 将全部有时间戳的行按时间从旧到新排列，把盘口转为数字
- 存在"先向某方向移动≥0.5球，再反向回移≥0.5球"的异常：
  终盘比最低点更偏主队（更负）→ s5=1；更偏客队（更正）→ s5=-1；无异常 → s5=0

任务3（市场解读）：
分析全部时间序列，用1~2句中文总结：主水趋势、盘口关键变动、是否有洗水、综合市场倾向。

重要：只输出下面的JSON，不加任何解释文字，不用markdown代码块，不在JSON外加任何内容。
market_summary字段中不能使用双引号，用顿号代替。

{
  "close_line": 终盘盘口数值（数字）,
  "close_home": 终盘主队水位（数字）,
  "close_away": 终盘客队水位（数字）,
  "s5": 降盘异常（整数）,
  "market_summary": "市场解读文字"
}

${LINE_RULES}
数字字段无法识别填null，market_summary无法判断填null。`;
    return callAPI(imageFile, prompt);
  }

  return { recognizeOpening, recognizeClosing };
})();
