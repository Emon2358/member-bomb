import { serve } from "https://deno.land/std@0.201.0/http/server.ts";

// メモリ内ストレージ
const botData: { guildId: string; botToken: string; clientSecret: string } = { guildId: "", botToken: "", clientSecret: "" };
const userTokens = new Map<string, any>();

// HTMLテンプレート
const bombPage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bomb Settings</title>
</head>
<body>
  <h1>Configure Bot</h1>
  <form action="/bomb" method="POST">
    <label for="guildId">Guild ID:</label><br>
    <input type="text" id="guildId" name="guildId" required><br><br>
    <label for="botToken">Bot Token:</label><br>
    <input type="text" id="botToken" name="botToken" required><br><br>
    <label for="clientSecret">Client Secret:</label><br>
    <input type="text" id="clientSecret" name="clientSecret" required><br><br>
    <button type="submit">Save Settings</button>
  </form>
  <h2>Generated OAuth2 URL</h2>
  <p id="authUrl">Please save your settings first!</p>

  <h2>Join All Users</h2>
  <button id="joinAllBtn" onclick="joinAll()">Join All Users to the Guild</button>
  <p id="status"></p>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      fetch("/auth-url")
        .then((res) => res.text())
        .then((url) => {
          document.getElementById("authUrl").innerHTML = \`<a href="\${url}" target="_blank">Click to Authenticate</a>\`;
        })
        .catch(() => {
          document.getElementById("authUrl").textContent = "Unable to fetch OAuth2 URL.";
        });
    });

    function joinAll() {
      const statusElement = document.getElementById("status");
      statusElement.textContent = "Processing...";
      
      fetch('/join-all', { 
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })
        .then(response => {
          if (!response.ok) {
            throw new Error('Network response was not ok');
          }
          return response.text();
        })
        .then(result => {
          statusElement.textContent = result;
        })
        .catch(error => {
          statusElement.textContent = 'Failed to join guild: ' + error.message;
        });
    }
  </script>
</body>
</html>
`;

// トークンを交換
async function exchangeToken(code: string): Promise<any> {
  try {
    const clientId = botData.botToken.split(".")[0];
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: botData.clientSecret,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: "https://member-bomb56.deno.dev/callback",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Token exchange error:", errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Exchange token error:", error);
    throw error;
  }
}

// サーバーに参加させる
async function addUserToGuild(accessToken: string, guildId: string) {
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
      method: "PUT",
      headers: {
        "Authorization": `Bot ${botData.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: accessToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Add to guild error:", errorText);
      throw new Error(`Failed to join guild: ${response.status} ${errorText}`);
    }

    return response;
  } catch (error) {
    console.error("Add to guild error:", error);
    throw error;
  }
}

// サーバー起動
serve(async (req) => {
  const url = new URL(req.url);

  // 設定画面
  if (url.pathname === "/bomb" && req.method === "GET") {
    return new Response(bombPage, { 
      headers: { 
        "Content-Type": "text/html",
        "Cache-Control": "no-store"
      } 
    });
  }

  // 設定保存
  if (url.pathname === "/bomb" && req.method === "POST") {
    try {
      const body = new TextDecoder().decode(await req.arrayBuffer());
      const params = new URLSearchParams(body);
      botData.guildId = params.get("guildId")!;
      botData.botToken = params.get("botToken")!;
      botData.clientSecret = params.get("clientSecret")!;

      return new Response("Settings saved successfully! Return to the bomb page to generate your OAuth2 URL.", {
        headers: { "Content-Type": "text/plain" },
      });
    } catch (error) {
      console.error("Save settings error:", error);
      return new Response("Failed to save settings: " + error.message, { status: 500 });
    }
  }

  // OAuth2 URL生成
  if (url.pathname === "/auth-url") {
    if (!botData.guildId || !botData.botToken || !botData.clientSecret) {
      return new Response("Settings not configured yet.", { status: 400 });
    }

    try {
      const state = crypto.randomUUID();
      const clientId = botData.botToken.split(".")[0];
      const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${
        encodeURIComponent("https://member-bomb56.deno.dev/callback")
      }&response_type=code&scope=identify%20guilds.join&state=${state}`;
      
      return new Response(authUrl);
    } catch (error) {
      console.error("Generate auth URL error:", error);
      return new Response("Failed to generate auth URL: " + error.message, { status: 500 });
    }
  }

  // OAuth2 コールバック
  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return new Response("Missing code or state parameter", { status: 400 });
    }

    try {
      const tokenData = await exchangeToken(code);
      userTokens.set(state, tokenData);
      return new Response(
        "Authentication successful! Return to /bomb and proceed with joining the server.",
        { headers: { "Content-Type": "text/plain" } }
      );
    } catch (error) {
      console.error("Callback error:", error);
      return new Response("Authentication failed: " + error.message, { status: 500 });
    }
  }

  // サーバーに一斉参加
  if (url.pathname === "/join-all" && req.method === "POST") {
    if (userTokens.size === 0) {
      return new Response("No authenticated users found.", { status: 400 });
    }

    try {
      const results = await Promise.allSettled(
        [...userTokens.values()].map(token =>
          addUserToGuild(token.access_token, botData.guildId)
        )
      );

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;

      return new Response(
        `Join operation completed: ${successful} successful, ${failed} failed`,
        { headers: { "Content-Type": "text/plain" } }
      );
    } catch (error) {
      console.error("Join all error:", error);
      return new Response("Failed to join users: " + error.message, { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
});
