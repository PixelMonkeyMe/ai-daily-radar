import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const apiKey = Deno.env.get('qwen_api_key')
    if (!apiKey) {
      return new Response(JSON.stringify({ success: false, error: 'qwen_api_key secret not set' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    const resp = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'user', content: '请回复OK' }],
        max_tokens: 10,
      }),
    })

    const data = await resp.json()
    if (resp.ok && data.choices) {
      return new Response(JSON.stringify({
        success: true,
        message: 'qwen_api_key works',
        response: data.choices[0].message?.content,
        httpStatus: resp.status,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'Qwen API error',
        status: resp.status,
        body: data,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: resp.status })
    }
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
