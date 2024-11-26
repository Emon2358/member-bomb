// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.197.0/http/server.ts";

// ファイルパス
const CONFIG_FILE = "./config.json";
const USERS_FILE = "./users.json";

// 設定とユーザー情報
let config: Record<string, string> = {};
let authenticatedUsers: Array<any> = [];

// ファイル読み込み・書き込み関数
async function loadConfig() {
  try {
    const data = await Deno.readTextFile(CONFIG_FILE);
    config = JSON.parse(data);
  } catch (error) {
    console.error("設定ファイルの読み込みエラー:", error);
    config = {};
  }
}

async function saveConfig() {
  try {
    await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("設定ファイルの保存エラー:", error);
  }
}

async function loadUsers() {
  try {
    const data = await Deno.readTextFile(USERS_FILE);
    authenticatedUsers = JSON.parse(data);
  } catch (error) {
    console.error("ユーザーファイルの読み込みエラー:", error);
    authenticatedUsers = [];
  }
}

async function saveUsers() {
  try {
    await Deno.writeTextFile(USERS_FILE, JSON.stringify(authenticatedUsers, null, 2));
  } catch (error) {
    console.error("ユーザーファイルの保存エラー:", error);
  }
}

// メインハンドラー
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/kanri") {
    const authUrl =
      config.CLIENT_ID && config.REDIRECT_URI
        ? `https://discord.com/oauth2/authorize?client_id=${config.CLIENT_ID}&redirect_uri=${encodeURIComponent(
            config.REDIRECT_URI
          )}&response_type=code&scope=identify%20guilds`
        : null;

    if (authUrl && !config.AUTH_URL) {
      config.AUTH_URL = authUrl;
      await saveConfig();
    }

    const body = `
      <h1>設定情報を入力</h1>
      <form action="/save-config" method="POST">
        <label for="CLIENT_ID">Discord Client ID</label>
        <input type="text" name="CLIENT_ID" value="${config.CLIENT_ID}" required><br>

        <label for="CLIENT_SECRET">Discord Client Secret</label>
        <input type="text" name="CLIENT_SECRET" value="${config.CLIENT_SECRET}" required><br>

        <label for="REDIRECT_URI">Redirect URI</label>
        <input type="text" name="REDIRECT_URI" value="${config.REDIRECT_URI}" required><br>

        <button type="submit">設定を保存</button>
      </form>
      ${authUrl ? `<p><a href="${authUrl}">Discord認証を開始</a></p>` : ""}
    `;
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (url.pathname === "/save-config" && req.method === "POST") {
    try {
      const formData = await req.formData();
      config.CLIENT_ID = formData.get("CLIENT_ID") as string || "";
      config.CLIENT_SECRET = formData.get("CLIENT_SECRET") as string || "";
      config.REDIRECT_URI = formData.get("REDIRECT_URI") as string || "";

      if (config.CLIENT_ID && config.REDIRECT_URI) {
        config.AUTH_URL = `https://discord.com/oauth2/authorize?client_id=${config.CLIENT_ID}&redirect_uri=${encodeURIComponent(
          config.REDIRECT_URI
        )}&response_type=code&scope=identify%20guilds`;
      }

      await saveConfig();

      return new Response("", { status: 303, headers: { Location: "/joinserver" } });
    } catch (error) {
      console.error("設定保存エラー:", error);
      return new Response(`<p>エラー: ${error.message}</p>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  } else if (url.pathname === "/callback" && req.method === "GET") {
    const code = url.searchParams.get("code");

    if (!code || !config.CLIENT_ID || !config.CLIENT_SECRET || !config.REDIRECT_URI) {
      return new Response("認証に必要な情報が不足しています。", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.CLIENT_ID,
          client_secret: config.CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: config.REDIRECT_URI,
        }),
      });

      const tokenData = await tokenRes.json();
      const userRes = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const userData = await userRes.json();

      const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      const guildsData = await guildsRes.json();

      authenticatedUsers.push({
        username: userData.username,
        discriminator: userData.discriminator,
        userId: userData.id,
        avatar: userData.avatar,
        guilds: guildsData.map((g: any) => ({ name: g.name, id: g.id })),
      });

      await saveUsers();

      return new Response("", { status: 303, headers: { Location: "/joinserver" } });
    } catch (error) {
      console.error("認証エラー:", error);
      return new Response(`<p>エラー: ${error.message}</p>`, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  } else if (url.pathname === "/joinserver" && req.method === "GET") {
    const body = `
      <h1>サーバー名で検索</h1>
      <form action="/joinserver" method="POST">
        <label for="guild_name">サーバー名</label>
        <input type="text" name="guild_name" required><br>
        <button type="submit">検索</button>
      </form>
    `;
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else if (url.pathname === "/joinserver" && req.method === "POST") {
    const formData = await req.formData();
    const guildName = formData.get("guild_name") as string;

    const filteredUsers = authenticatedUsers.filter((user) =>
      user.guilds.some((guild: any) => guild.name.toLowerCase().includes(guildName.toLowerCase()))
    );

    const userListHtml = filteredUsers
      .map(
        (user) => `
          <li>
            <strong>${user.username}#${user.discriminator}</strong><br>
            <ul>${user.guilds
              .map((g) => `<li>${g.name} (ID: ${g.id})</li>`)
              .join("")}</ul>
          </li>`
      )
      .join("");

    return new Response(`
      <h2>検索結果</h2>
      <ul>${userListHtml}</ul>
      <p><a href="/joinserver">再度検索</a></p>
    `, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } else {
    return new Response("404 Not Found", { status: 404 });
  }
}

// 初期設定を読み込み
await loadConfig();
await loadUsers();

serve(handler);
