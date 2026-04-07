const { chromium } = require("playwright");
const { checkHttpStatus, checkConsoleErrors, checkElementsExist, checkElementToggle, checkLinkNavigation, checkFormSubmit } = require("./checks");
const { printSummary, writeMarkdownReport } = require("./reporter");
const fs = require("fs");
const path = require("path");

function loadScenarios(scenariosPath) {
  const raw = fs.readFileSync(scenariosPath, "utf-8");
  const data = JSON.parse(raw);
  return data.scenarios;
}

// --target URLからサイト名を生成（results/以下のサブディレクトリ名に使用）
function siteNameFromUrl(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/\./g, "-");
  const pathPart = u.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "_");
  return pathPart ? `${host}_${pathPart}` : host;
}

async function takeScreenshot(page, scenario, runDir) {
  const screenshotsDir = path.join(runDir, "screenshots");
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
  const safeName = scenario.name.replace(/[/\\:*?"<>|]/g, "_");
  const screenshotPath = path.join(screenshotsDir, `${safeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function runScenario(browser, baseUrl, scenario, options) {
  const contextOptions = scenario.viewport ? { viewport: scenario.viewport } : {};
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const consoleErrors = [];
  const uncaughtErrors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    uncaughtErrors.push(error.message);
  });

  const url = new URL(scenario.path, baseUrl).href;
  const result = {
    name: scenario.name,
    url,
    pass: true,
    checks: [],
  };

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(1000);

    for (const checkName of scenario.checks) {
      let checkResult;

      if (checkName === "http_status") {
        checkResult = await checkHttpStatus(page, response);
      } else if (checkName === "console_errors") {
        checkResult = await checkConsoleErrors(page, consoleErrors, uncaughtErrors);
      } else if (checkName === "elements_exist") {
        checkResult = await checkElementsExist(page, scenario.elements);
      } else if (checkName === "element_toggle") {
        checkResult = await checkElementToggle(page, scenario.toggles);
      } else if (checkName === "link_navigation") {
        checkResult = await checkLinkNavigation(page, scenario.navigations, url);
      } else if (checkName === "form_submit") {
        checkResult = await checkFormSubmit(page, scenario.form, url);
      } else {
        checkResult = { name: checkName, pass: false, detail: "未知のチェック種別" };
      }

      result.checks.push(checkResult);
      if (!checkResult.pass) {
        result.pass = false;
      }
    }
  } catch (error) {
    result.pass = false;
    result.checks.push({
      name: "ページアクセス",
      pass: false,
      detail: error.message,
    });
  } finally {
    const shouldScreenshot =
      options.screenshot === "always" || (!result.pass && options.screenshot === "fail");
    if (shouldScreenshot) {
      result.screenshot = await takeScreenshot(page, scenario, options.runDir);
    }
    await context.close();
  }

  return result;
}

async function run(targetUrl, options = {}) {
  const startTime = new Date();
  console.log(`\nテスト開始: ${targetUrl}`);
  console.log(`実行日時: ${startTime.toLocaleString("ja-JP")}`);

  const scenariosPath = options.scenarios || path.join(process.cwd(), "scenarios.json");

  if (!fs.existsSync(scenariosPath)) {
    console.error(`シナリオファイルが見つかりません: ${scenariosPath}`);
    process.exit(1);
  }

  const scenarios = loadScenarios(scenariosPath);
  console.log(`シナリオ数: ${scenarios.length}\n`);

  const siteName = siteNameFromUrl(targetUrl);
  const runTimestamp = startTime.toISOString().replace(/[:.]/g, "-").slice(0, 16); // 分単位
  const runDir = path.join(process.cwd(), "results", siteName, runTimestamp);

  const headless = options.headless || false;
  const launchOptions = headless
    ? { headless: true }
    : { headless: false, slowMo: 500 };

  console.log(`モード: ${headless ? "headless" : "ブラウザ表示あり (slowMo: 500)"}\n`);

  const browser = await chromium.launch(launchOptions);
  const results = [];

  for (const scenario of scenarios) {
    process.stdout.write(`  実行中: ${scenario.name} ...`);
    const result = await runScenario(browser, targetUrl, scenario, {
      screenshot: options.screenshot || "fail",
      runDir,
    });
    results.push(result);
    console.log(result.pass ? " ✅ Pass" : " ❌ Fail");
  }

  await browser.close();

  const summary = {
    targetUrl,
    startTime,
    scenarios: results,
    totalPass: results.filter((r) => r.pass).length,
    totalFail: results.filter((r) => !r.pass).length,
    total: results.length,
    allPass: results.every((r) => r.pass),
  };

  printSummary(summary);
  writeMarkdownReport(summary, runDir);

  return summary;
}

module.exports = { run };
