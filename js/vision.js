/* ============================================================
   vision.js — Gemini Vision API 图片识别模块
   调用 Gemini 2.0 Flash 识别澳客截图中的亚盘赔率数据

   澳客页面有两种截图状态：
   【开盘截图】无"初始盘口"标签，所有行均有时间戳，最新在上最旧在下
              → 取最下方那行（赛前小时数最大）= 初盘数据
   【临盘截图】顶部有"初始盘口"标签行（无时间戳），其后最新行紧跟其下
              → 取"初始盘口"下方第一个有时间戳的行 = 终盘数据
   ============================================================ */

const Vision = (() => {

  const MODEL = 'gemini-1.5-flash-latest';

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
    return (Storage.Settings.get().gemini_api_key || '').trim();
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
   * callVision — 发送图片+提示到 Gemini API，返回原始文本
   * systemPrompt 为可选系统指令
   */
  async function callVision(imageFile, prompt, maxTokens, systemPrompt = null) {
    const key = getKey();
    if (!key) throw new Error('请先在设置页填入 Gemini API Key');

    const base64    = await toBase64(imageFile);
    const mediaType = imageFile.type.startsWith('image/') ? imageFile.type : 'image/jpeg';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: mediaType, data: base64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { maxOutputTokens: maxTokens },
    };

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      let msg = `API错误 ${resp.status}`;
      try { const e = await resp.json(); msg = e.error?.message || msg; } catch {}
      throw new Error(msg);
    }

    const data = await resp.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
  }

  /**
   * extractJSON — 多层 JSON 解析，从模型返回文本中提取 JSON 对象
   */
  function extractJSON(str) {
    // 1. 代码块
    let m = str.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
    // 2. 直接解析
    try { return JSON.parse(str); } catch {}
    // 3. 提取 {...}
    m = str.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    // 4. 清洗控制字符
    if (m) {
      const cleaned = m[0].replace(/[\x00-\x1F\x7F]/g, ' ');
      try { return JSON.parse(cleaned); } catch {}
    }
    // 5. 修复 market_summary 中双引号
    if (m) {
      const fixed = m[0].replace(
        /("market_summary"\s*:\s*")([\s\S]*?)("\s*\}\s*$)/,
        (_, pre, val, post) => pre + val.replace(/"/g, '\u2018') + post
      );
      try { return JSON.parse(fixed); } catch {}
    }
    return null;
  }

  /**
   * extractFieldsFallback — 终极兜底：逐字段正则提取数字
   */
  function extractFieldsFallback(str, fields) {
    const result = {};
    let found = false;
    for (const f of fields) {
      const re = new RegExp(`"${f}"\\s*:\\s*(-?[\\d.]+|null)`, 'i');
      const m = str.match(re);
      if (m) {
        result[f] = m[1] === 'null' ? null : parseFloat(m[1]);
        found = true;
      } else {
        result[f] = null;
      }
    }
    if (fields.includes('market_summary')) {
      const ms = str.match(/"market_summary"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
      result.market_summary = ms ? ms[1].replace(/"/g, '\u2018') : null;
    }
    return found ? result : null;
  }

  /**
   * recognizeOpening(imageFile)
   * 平博开盘完整时间轴：提取初盘数据 + 核心窗口数据 + S5深V反转（4-12小时区间）
   */
  async function recognizeOpening(imageFile) {
    const prompt = `你是一个专业的亚洲盘口分析师。请分析这张平博（Pinnacle）盘口变化截图。

截图格式说明：
- 列表从下到上按时间排列，最底部是最早的初始盘口，最顶部是最新数据
- 每行格式为：主水 盘口类型 客水 时间标注（赛前X小时Y分）
- 时间越大（如赛前600小时）= 越早；时间越小（如赛前2小时）= 越新

${LINE_RULES}

请提取以下信息并以JSON返回：

1. 初始盘口（时间最大的那行，最底部）：open_line / open_home / open_away

2. 核心分析窗口（赛前4-12小时区间内，找该区间最新一行）：
   window_home / window_away / window_line

3. S5早期深V检测（仅看赛前4-12小时区间内）：
   在该区间内，盘口是否先向客队方向退让（主水升高或让球减少），随后被大资金买回反转（主水降低或让球升级）？
   有且回升偏主→s5=1；有且回升偏客→s5=-1；无深V异常→s5=0

4. 整体走势：trend（"偏主"/"偏客"/"中性"）

你可以先分析推理，但最后一行必须是且仅是如下格式的JSON：
{"open_line":数字,"open_home":数字,"open_away":数字,"window_home":数字,"window_away":数字,"window_line":数字,"s5":整数,"trend":"文字"}

无法识别的字段填null。`;

    const sysPrompt = 'You extract data from images. After your analysis, you MUST end your response with a JSON object on its own line. The JSON is the final thing in your response.';
    const raw = await callVision(imageFile, prompt, 2048, sysPrompt);
    const result = extractJSON(raw)
      || extractFieldsFallback(raw, ['open_line', 'open_home', 'open_away', 'window_home', 'window_away', 'window_line', 's5']);
    if (!result) throw new Error('初盘识别失败，请重试');
    return result;
  }

  /**
   * recognizeClosing(imageFile, pinnOpenResult)
   * 平博临盘视图：提取终盘数据，AI直接计算S1/S3/S4，判断噪音区
   */
  async function recognizeClosing(imageFile, pinnOpenResult = null) {
    const openContext = pinnOpenResult
      ? `\n参考平博初盘数据（用于S4对比）：盘口${pinnOpenResult.open_line ?? '未知'}，主水${pinnOpenResult.open_home ?? '未知'}，客水${pinnOpenResult.open_away ?? '未知'}`
      : '';

    const numPrompt = `你是一个专业的亚洲盘口分析师。请分析这张平博（Pinnacle）临盘视图截图。

截图格式说明：
- 这是临近开球时的盘口状态
- 页面第一行右侧标注"初始盘口"（无时间），其余行有"赛前X小时Y分"时间戳
- 时间数越小（如赛前1小时）= 越新；赛前2小时以内属于噪音区${openContext}

${LINE_RULES}

请完成以下任务并以JSON返回：

1. 终盘数据（有时间戳的行中，时间最小那行）：close_line / close_home / close_away
   in_noise_zone：终盘时间是否在赛前2小时以内？是=1，否=0

2. S1平博终盘重心：close_home - close_away
   差值 < -0.03 → s1=1（偏主）；差值 > 0.03 → s1=-1（偏客）；否则 s1=0

3. S3终盘水位绝对差：
   close_home 比 close_away 低超0.08 → s3=1；低超0.08反向 → s3=-1；否则 s3=0

4. S4盘口水位背离（对比初盘→终盘变化，噪音区强制s4=0）：
   盘口升级（主让球增加）但主水反而升高 → s4=-1
   盘口退让（主让球减少）但客水反而升高 → s4=1
   方向一致或无明显背离 → s4=0；噪音区 → s4=0

5. 市场解读：分析关盘前1-2小时的密集变动，用1~2句中文总结资金方向和市场倾向。放入 market_summary 字段（纯中文，不含双引号）。

你可以先分析推理，但最后一行必须是且仅是如下格式的JSON：
{"close_line":数字,"close_home":数字,"close_away":数字,"in_noise_zone":整数,"s1":整数,"s3":整数,"s4":整数,"market_summary":"文字"}

无法识别的字段填null。`;

    const sysPrompt = 'You extract data from images. After your analysis, you MUST end your response with a JSON object on its own line. The JSON is the final thing in your response.';
    const numRaw = await callVision(imageFile, numPrompt, 2500, sysPrompt);
    const numResult = extractJSON(numRaw)
      || extractFieldsFallback(numRaw, ['close_line', 'close_home', 'close_away', 'in_noise_zone', 's1', 's3', 's4', 'market_summary']);
    if (!numResult) throw new Error('终盘识别失败。API原始返回：' + (numRaw || '(空)').substring(0, 200));

    if (numResult.in_noise_zone === 1) numResult.s4 = 0;
    // 清理 market_summary 中可能的引号
    if (numResult.market_summary && typeof numResult.market_summary === 'string') {
      numResult.market_summary = numResult.market_summary.replace(/^["'\s]+|["'\s]+$/g, '') || null;
    }

    return numResult;
  }

  /**
   * recognizeWilliamTimeline(imageFile, pinnOpenResult)
   * 威廉希尔完整时间轴：提取初盘+最新盘，AI直接计算S2
   */
  async function recognizeWilliamTimeline(imageFile, pinnOpenResult = null) {
    const openContext = pinnOpenResult
      ? `\n参考平博初盘数据（用于S2计算）：主水${pinnOpenResult.open_home ?? '未知'}，客水${pinnOpenResult.open_away ?? '未知'}`
      : '';

    const prompt = `你是一个专业的亚洲盘口分析师。请分析这张威廉希尔（William Hill）盘口变化截图。

截图格式说明：
- 列表从下到上按时间排列，最底部是最早的初始盘口，最顶部是最新数据
- 威廉希尔属于传统休闲型博彩公司，其赔率受公众情绪影响较大${openContext}

${LINE_RULES}

请完成以下任务并以JSON返回：

1. 初始盘口（时间最大那行，最底部）：wh_open_home / wh_open_away
2. 最新盘口（时间最小那行，最顶部）：wh_close_line / wh_close_home / wh_close_away

3. S2平博vs威廉分歧（使用初盘对初盘，判断"明显"标准：主客水差值>0.10）：
   平博初盘偏主（主水明显低于客水）AND 威廉初盘偏客（主水明显高于客水）→ s2=1（跟平博偏主）
   平博初盘偏客（主水明显高于客水）AND 威廉初盘偏主（主水明显低于客水）→ s2=-1（跟平博偏客）
   两家方向一致或无明显分歧 → s2=0
   注：若无平博初盘参考数据，仅根据威廉走势输出s2=0

你可以先分析推理，但最后一行必须是且仅是如下格式的JSON：
{"wh_open_home":数字,"wh_open_away":数字,"wh_close_line":数字,"wh_close_home":数字,"wh_close_away":数字,"s2":整数}

无法识别的字段填null。`;

    const sysPrompt = 'You extract data from images. After your analysis, you MUST end your response with a JSON object on its own line. The JSON is the final thing in your response.';
    const raw = await callVision(imageFile, prompt, 2048, sysPrompt);
    const result = extractJSON(raw)
      || extractFieldsFallback(raw, ['wh_open_home', 'wh_open_away', 'wh_close_line', 'wh_close_home', 'wh_close_away', 's2']);
    if (!result) throw new Error('威廉希尔时间轴识别失败，请重试');
    return result;
  }

  return { recognizeOpening, recognizeClosing, recognizeWilliamTimeline };
})();
