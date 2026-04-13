import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.MINIMAX_API_KEY || '';
const model = process.env.MINIMAX_MODEL || 'MiniMax-M2.7-highspeed';

const bases = ['https://api.minimax.io/v1', 'https://api.minimaxi.com/v1'];

for (const base of bases) {
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 32,
      }),
    });

    const text = await response.text();
    console.log(
      JSON.stringify(
        {
          base,
          status: response.status,
          body: text.slice(0, 400),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          base,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  }
}
