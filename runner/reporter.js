const fs = require("fs");
const path = require("path");

function printSummary(summary) {
  const divider = "─".repeat(50);

  console.log();
  console.log(divider);
  console.log(`  サマリー: ${summary.totalPass} Pass / ${summary.totalFail} Fail (全${summary.total}件)`);
  console.log(divider);

  for (const scenario of summary.scenarios) {
    const icon = scenario.pass ? "✅" : "❌";
    console.log(`  ${icon} ${scenario.name} (${scenario.url})`);

    if (scenario.screenshot) {
      console.log(`     📷 ${scenario.screenshot}`);
    }

    for (const check of scenario.checks) {
      const ci = check.pass ? "  ✓" : "  ✗";
      console.log(`     ${ci} ${check.name}: ${check.detail}`);

      if (check.errors) {
        for (const err of check.errors) {
          console.log(`       - ${err}`);
        }
      }

      if (check.items) {
        for (const item of check.items) {
          if (!item.pass) {
            const msg = item.detail ? `${item.target}: ${item.detail}` : `見つからない: ${item.target}`;
            console.log(`       - ${msg}`);
          }
        }
      }
    }
  }

  console.log(divider);
  console.log(summary.allPass ? "  🟢 全シナリオ Pass" : "  🔴 Failあり");
  console.log(divider);
  console.log();
}

function formatMarkdown(summary, runDir) {
  const lines = [];
  const timestamp = summary.startTime.toLocaleString("ja-JP");

  lines.push("# テスト結果レポート");
  lines.push(`実行日時: ${timestamp}`);
  lines.push(`テスト対象: ${summary.targetUrl}`);
  lines.push("");
  lines.push("## サマリー");
  lines.push(`- 合計: ${summary.total}シナリオ`);
  lines.push(`- Pass: ${summary.totalPass}`);
  lines.push(`- Fail: ${summary.totalFail}`);
  lines.push("");
  lines.push("## 詳細");

  for (const scenario of summary.scenarios) {
    const icon = scenario.pass ? "✅" : "❌";
    lines.push("");
    lines.push(`### ${icon} ${scenario.name}`);
    lines.push(`- URL: ${scenario.url}`);

    for (const check of scenario.checks) {
      const ci = check.pass ? "✅" : "❌";
      lines.push(`- ${check.name}: ${ci} ${check.detail}`);

      if (check.errors && check.errors.length > 0) {
        for (const err of check.errors) {
          lines.push(`  - ${err}`);
        }
      }

      if (check.items) {
        for (const item of check.items) {
          const ii = item.pass ? "✅" : "❌";
          const suffix = item.detail ? ` — ${item.detail}` : "";
          lines.push(`  - ${ii} ${item.target}${suffix}`);
        }
      }
    }
  }

  // スクリーンショット対応表
  const screenshotScenarios = summary.scenarios.filter((s) => s.screenshot);
  if (screenshotScenarios.length > 0) {
    lines.push("");
    lines.push("## スクリーンショット");
    lines.push("");
    lines.push("| シナリオ | ファイル |");
    lines.push("|---|---|");
    for (const scenario of screenshotScenarios) {
      const filename = path.basename(scenario.screenshot);
      lines.push(`| ${scenario.name} | [${filename}](./screenshots/${filename}) |`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function writeMarkdownReport(summary, runDir) {
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  const filePath = path.join(runDir, "report.md");
  const markdown = formatMarkdown(summary, runDir);
  fs.writeFileSync(filePath, markdown, "utf-8");
  console.log(`レポート出力: ${filePath}`);
}

module.exports = { printSummary, writeMarkdownReport };
