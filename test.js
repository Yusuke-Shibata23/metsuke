const { run } = require("./runner");

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1]) {
      options.target = args[i + 1];
      i++;
    }
    if (args[i] === "--golden" && args[i + 1]) {
      options.golden = args[i + 1];
      i++;
    }
    if (args[i] === "--scenarios" && args[i + 1]) {
      options.scenarios = args[i + 1];
      i++;
    }
    if (args[i] === "--headless") {
      options.headless = true;
    }
    if (args[i] === "--screenshot" && args[i + 1]) {
      options.screenshot = args[i + 1];
      i++;
    }
    if (args[i] === "--slow-mo" && args[i + 1]) {
      options.slowMo = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  if (!options.target) {
    console.error("使い方: node test.js --target <URL> [--scenarios <path>] [--headless]");
    console.error("例: node test.js --target https://example.com");
    process.exit(1);
  }

  const summary = await run(options.target, {
    scenarios: options.scenarios,
    headless: options.headless,
    screenshot: options.screenshot || "fail",
    slowMo: options.slowMo,
  });
  process.exit(summary.allPass ? 0 : 1);
}

main().catch((error) => {
  console.error("予期しないエラー:", error.message);
  process.exit(1);
});
