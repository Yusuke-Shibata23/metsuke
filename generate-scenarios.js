const { chromium } = require("playwright");
const fs = require("fs");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      options.url = args[i + 1];
      i++;
    }
    if (args[i] === "--out" && args[i + 1]) {
      options.out = args[i + 1];
      i++;
    }
    if (args[i] === "--max-pages" && args[i + 1]) {
      options.maxPages = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return options;
}

function domainToFilename(url) {
  const hostname = new URL(url).hostname.replace(/\./g, "-");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  return `scenarios/${hostname}_${ts}.json`;
}

// ────────────────────────────────────────────────
// ① サイト構造の把握（巡回・DOM解析）
// ────────────────────────────────────────────────

// ナビリンクをクリックして遷移先URLを発見する（SPA・静的サイト両対応）
async function discoverLinks(page, baseUrl) {
  const originUrl = page.url();
  const baseOrigin = new URL(baseUrl).origin;
  const discovered = [];
  const seenUrls = new Set([originUrl]);

  // nav/header内のリンクテキストを一括取得（クリック前に収集）
  const linkTexts = await page.evaluate(() => {
    const links = document.querySelectorAll("nav a, header a");
    const texts = [];
    for (const a of links) {
      const text = a.textContent?.trim().replace(/\s+/g, " ");
      if (text && text.length > 0 && text.length <= 40) {
        texts.push(text);
      }
    }
    return [...new Set(texts)];
  });

  console.log(`  リンク候補: ${linkTexts.join(", ") || "なし"}`);

  for (const text of linkTexts) {
    const beforeUrl = page.url();

    try {
      await page.getByRole("link", { name: text }).first().click({ force: true });
      // hash変化にも対応するため waitForFunction でURL変化を検知
      await page.waitForFunction(
        (before) => window.location.href !== before,
        beforeUrl,
        { timeout: 3000 }
      );

      const afterUrl = page.url();

      const afterParsed = new URL(afterUrl);
      // ホームルート（#/ や #）はトップページと同一のためスキップ
      const isHomeHash = afterParsed.hash === "#/" || afterParsed.hash === "#";
      if (!seenUrls.has(afterUrl) && afterParsed.origin === baseOrigin && !isHomeHash) {
        seenUrls.add(afterUrl);
        discovered.push({ url: afterUrl, text });
        console.log(`  発見: ${afterUrl} (「${text}」)`);
      }
    } catch {
      // URL変化なし（外部リンク・アンカー等）→ スキップ
    }

    // 元のページに戻る
    await page.goto(originUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
  }

  return discovered;
}

// ページのDOM情報を収集する（純粋なデータ収集）
async function analyzePage(page, url) {
  console.log(`  解析中: ${url}`);

  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // ハッシュナビゲーション（SPA）はHTTPリクエストを発生させないため response が null になる
  const isHashNav = new URL(url).hash !== "";
  if (!response && !isHashNav) {
    console.log(`    スキップ（レスポンスなし）`);
    return null;
  }
  if (response && response.status() >= 400) {
    console.log(`    スキップ（ステータス: ${response.status()}）`);
    return null;
  }

  await page.waitForTimeout(1500);

  const data = await page.evaluate(() => {
    const result = {};

    // セマンティックタグの存在確認
    result.tags = [];
    for (const tag of ["header", "footer", "nav", "main"]) {
      const el = document.querySelector(tag);
      if (el && el.offsetParent !== null) {
        result.tags.push(tag);
      }
    }

    // 見出しテキスト (h1, h2)
    result.headings = [];
    for (const tag of ["h1", "h2"]) {
      const els = document.querySelectorAll(tag);
      for (const el of els) {
        const text = el.textContent?.trim().replace(/\s+/g, " ");
        if (text && text.length > 0 && text.length <= 50 && el.offsetParent !== null) {
          result.headings.push(text);
        }
      }
    }

    // トグル候補: 非表示のサブメニューを持つクリッカブル要素
    result.toggleCandidates = [];
    const seenTriggers = new Set();
    const triggers = document.querySelectorAll(
      "[class*=trigger], [class*=toggle], [class*=accordion], [aria-expanded], [aria-haspopup]"
    );
    for (const el of triggers) {
      const text = el.textContent?.trim().split("\n")[0]?.trim();
      if (text && text.length > 0 && text.length <= 40 && el.offsetParent !== null && !seenTriggers.has(text)) {
        const parent = el.closest("li, div, section");
        if (parent) {
          const hiddenPanel = parent.querySelector("[class*=panel], [class*=menu], [class*=content], [class*=drawer]");
          if (hiddenPanel && hiddenPanel.offsetParent === null) {
            const panelText = hiddenPanel.textContent?.trim().split("\n").find((l) => l.trim().length > 0)?.trim();
            if (panelText && panelText !== text && panelText.length <= 50) {
              seenTriggers.add(text);
              result.toggleCandidates.push({
                triggerText: text,
                expectText: panelText,
              });
            }
          }
        }
      }
    }

    return result;
  });

  return data;
}

// URLからシナリオ用pathを抽出（ハッシュルーティング対応）
function urlToPath(url) {
  const parsed = new URL(url);
  return parsed.hash || parsed.pathname;
}

// サイト全体を巡回して構造データを収集する
async function crawlSite(browser, baseUrl, maxPages) {
  const context = await browser.newContext();
  const page = await context.newPage();

  // トップページを解析
  const topData = await analyzePage(page, baseUrl);
  if (!topData) {
    await context.close();
    return null;
  }

  const topUrl = page.url(); // goto後の正規化済みURL
  const pages = [
    { url: topUrl, path: urlToPath(topUrl), name: "トップページ", data: topData },
  ];
  const visitedUrls = new Set([topUrl]);

  if (pages.length < maxPages) {
    console.log("\nリンクを探索中...");
    const discovered = await discoverLinks(page, baseUrl);

    for (const { url, text } of discovered) {
      if (visitedUrls.size >= maxPages) break;
      if (visitedUrls.has(url)) continue;
      visitedUrls.add(url);

      const pageData = await analyzePage(page, url);
      if (!pageData) continue;

      const pageName = pageData.headings[0] || text;
      pages.push({ url, path: urlToPath(url), name: pageName, data: pageData });
    }
  }

  await context.close();
  return pages;
}

// ────────────────────────────────────────────────
// ②③ テストケースの選定・シナリオJSONへの書きおこし
//     （将来 Claude Code に置き換え可能）
// ────────────────────────────────────────────────

function buildScenario(name, pagePath, pageData) {
  const checks = ["http_status", "console_errors"];
  const scenario = { name, path: pagePath, checks };

  // elements_exist
  const hasTags = pageData.tags.length > 0;
  const hasTexts = pageData.headings.length > 0;
  if (hasTags || hasTexts) {
    checks.push("elements_exist");
    scenario.elements = {};
    if (hasTags) scenario.elements.tags = pageData.tags;
    if (hasTexts) scenario.elements.texts = pageData.headings.slice(0, 5);
  }

  // element_toggle
  if (pageData.toggleCandidates.length > 0) {
    checks.push("element_toggle");
    scenario.toggles = pageData.toggleCandidates.slice(0, 3).map((tc) => ({
      description: `「${tc.triggerText}」を開く`,
      trigger: { text: tc.triggerText, force: true },
      expect: { text: tc.expectText, visible: true },
    }));
  }

  return scenario;
}

// ────────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────────

async function main() {
  const options = parseArgs();

  if (!options.url) {
    console.error("使い方: node generate-scenarios.js --url <URL> [--out <file>] [--max-pages <N>]");
    process.exit(1);
  }

  const baseUrl = options.url.replace(/\/$/, "");
  const maxPages = options.maxPages || 10;
  const outFile = options.out || domainToFilename(options.url);

  console.log(`\nシナリオ生成開始: ${baseUrl}`);
  console.log(`最大ページ数: ${maxPages}\n`);

  const browser = await chromium.launch({ headless: true });
  const pages = await crawlSite(browser, baseUrl, maxPages);
  await browser.close();

  if (!pages) {
    console.error("トップページにアクセスできません");
    process.exit(1);
  }

  // ①の収集結果を②③でシナリオJSONに変換
  const scenarios = pages.map(({ name, path, data }) => buildScenario(name, path, data));

  const outDir = require("path").dirname(outFile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const output = { scenarios };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(`\n生成完了: ${outFile}`);
  console.log(`シナリオ数: ${scenarios.length}`);
  console.log(`巡回ページ: ${pages.map((p) => p.path).join(", ")}`);
}

main().catch((error) => {
  console.error("予期しないエラー:", error.message);
  process.exit(1);
});
