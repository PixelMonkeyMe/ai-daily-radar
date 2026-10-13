import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { start_date, end_date } = await req.json()

    if (!start_date || !end_date) {
      throw new Error('start_date and end_date are required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const kimiApiKey = Deno.env.get('KIMI_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Check cache first
    const cacheKey = `${start_date}_${end_date}`
    const { data: cached } = await supabase
      .from('analysis_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .gte('expires_at', new Date().toISOString())
      .single()

    if (cached) {
      return new Response(JSON.stringify({ success: true, data: cached.result, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Query items from the date range
    const { data: items, error } = await supabase
      .from('items')
      .select('*')
      .gte('date', start_date)
      .lte('date', end_date)
      .order('importance', { ascending: false })
      .limit(100)

    if (error) throw error
    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ success: true, data: null, message: '该时段暂无数据' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Prepare data for AI analysis
    const itemsSummary = items.map((item: any) => ({
      title: item.title,
      source: item.source,
      date: item.date,
      importance: item.importance,
      url: item.url,
    }))

    const prompt = `你是一位 AI 行业分析师。请分析 ${start_date} 至 ${end_date} 期间的 AI 日报数据，生成以下内容：

## 今日总览
用 2-3 句话概述这段时间 AI 领域的整体趋势和动态。

## 核心结论
提炼 3-5 条关键洞察，每条用一句话概括。

## 重点关注
列出最值得关注的 3-5 个项目/文章/动态，简要说明为什么值得关注。

## 对行业的作用
分析这些动态对智慧交通、消防、建筑等行业的潜在影响和机会。

## 风险提示
指出需要注意的风险点或不确定性。

以下是数据（按重要性排序）：
${JSON.stringify(itemsSummary, null, 2)}

请用中文回答，格式清晰，重点突出。`

    // Call Kimi API
    const kimiResponse = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${kimiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    })

    if (!kimiResponse.ok) {
      const errText = await kimiResponse.text()
      throw new Error(`Kimi API error: ${kimiResponse.status} - ${errText}`)
    }

    const kimiData = await kimiResponse.json()
    const analysis = kimiData.choices[0].message.content

    // Cache the result (24 hours)
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    await supabase.from('analysis_cache').upsert({
      cache_key: cacheKey,
      start_date,
      end_date,
      result: analysis,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' })

    return new Response(JSON.stringify({ success: true, data: analysis, cached: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
