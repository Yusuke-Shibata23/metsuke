/**
 * ロケータ定義からPlaywrightロケータを生成する
 * { text: "..." } → getByText
 * { role: "...", name: "..." } → getByRole
 * { label: "..." } → getByLabel
 */
function resolveLocator(page, locatorDef) {
  if (locatorDef.role) {
    return page.getByRole(locatorDef.role, { name: locatorDef.name });
  }
  if (locatorDef.label) {
    return page.getByLabel(locatorDef.label);
  }
  if (locatorDef.text) {
    return page.getByText(locatorDef.text, { exact: false });
  }
  throw new Error(`ロケータを解決できません: ${JSON.stringify(locatorDef)}`);
}

function describeLocator(locatorDef) {
  if (locatorDef.role) return `role="${locatorDef.role}" name="${locatorDef.name}"`;
  if (locatorDef.label) return `label="${locatorDef.label}"`;
  if (locatorDef.text) return `"${locatorDef.text}"`;
  return JSON.stringify(locatorDef);
}

async function checkHttpStatus(page, response) {
  const status = response ? response.status() : null;
  const pass = status !== null && status < 400;
  return {
    name: "HTTPステータス",
    pass,
    detail: pass ? `${status} OK` : `${status ?? "レスポンスなし"}`,
  };
}

async function checkConsoleErrors(page, consoleErrors, uncaughtErrors) {
  const allErrors = [
    ...consoleErrors.map((e) => `[console] ${e}`),
    ...uncaughtErrors.map((e) => `[uncaught] ${e}`),
  ];
  return {
    name: "コンソールエラー",
    pass: allErrors.length === 0,
    detail: allErrors.length === 0 ? "なし" : `${allErrors.length}件`,
    errors: allErrors,
  };
}

async function checkElementsExist(page, elements) {
  if (!elements) {
    return { name: "要素存在確認", pass: true, detail: "チェック対象なし", items: [] };
  }

  const items = [];

  if (elements.tags) {
    for (const tag of elements.tags) {
      const found = await page.locator(tag).first().waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
      items.push({ target: `<${tag}>`, pass: found });
    }
  }

  if (elements.texts) {
    for (const text of elements.texts) {
      const found = await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false);
      items.push({ target: `"${text}"`, pass: found });
    }
  }

  const failCount = items.filter((i) => !i.pass).length;
  return {
    name: "要素存在確認",
    pass: failCount === 0,
    detail: failCount === 0 ? `${items.length}件すべて存在` : `${failCount}/${items.length}件が見つからない`,
    items,
  };
}

async function checkElementToggle(page, toggles) {
  if (!toggles || toggles.length === 0) {
    return { name: "要素開閉確認", pass: true, detail: "チェック対象なし", items: [] };
  }

  const items = [];

  for (const toggle of toggles) {
    const desc = toggle.description || describeLocator(toggle.trigger);
    const expectVisible = toggle.expect.visible !== false;

    try {
      const triggerLocator = resolveLocator(page, toggle.trigger).first();
      await triggerLocator.click({ timeout: 5000, force: toggle.trigger.force || false });

      const expectLocator = resolveLocator(page, toggle.expect).first();

      let pass;
      if (expectVisible) {
        pass = await expectLocator.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
      } else {
        pass = await expectLocator.waitFor({ state: "hidden", timeout: 5000 }).then(() => true).catch(() => false);
      }

      const expectDesc = describeLocator(toggle.expect);
      const expectState = expectVisible ? "表示" : "非表示";
      items.push({
        target: desc,
        pass,
        detail: pass
          ? `${expectDesc} → ${expectState}を確認`
          : `${expectDesc} → ${expectState}にならなかった`,
      });
    } catch (error) {
      items.push({
        target: desc,
        pass: false,
        detail: error.message,
      });
    }
  }

  const failCount = items.filter((i) => !i.pass).length;
  return {
    name: "要素開閉確認",
    pass: failCount === 0,
    detail: failCount === 0 ? `${items.length}件すべて成功` : `${failCount}/${items.length}件が失敗`,
    items,
  };
}

async function checkLinkNavigation(page, navigations, originUrl) {
  if (!navigations || navigations.length === 0) {
    return { name: "リンク遷移確認", pass: true, detail: "チェック対象なし", items: [] };
  }

  const items = [];

  for (const nav of navigations) {
    const desc = nav.description || describeLocator(nav.trigger);

    try {
      const triggerLocator = resolveLocator(page, nav.trigger).first();

      await Promise.all([
        page.waitForFunction((origin) => window.location.href !== origin, originUrl, { timeout: 5000 }),
        triggerLocator.click({ force: nav.trigger.force || false }),
      ]);

      const currentUrl = page.url();
      const pass = currentUrl.includes(nav.expect.url_contains);

      items.push({
        target: desc,
        pass,
        detail: pass
          ? `"${nav.expect.url_contains}" を含む URL に遷移 → ${currentUrl}`
          : `遷移先 ${currentUrl} に "${nav.expect.url_contains}" が含まれない`,
      });
    } catch (error) {
      items.push({ target: desc, pass: false, detail: error.message });
    }

    // 次のナビゲーションのために元のページに戻る
    await page.goto(originUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(500);
  }

  const failCount = items.filter((i) => !i.pass).length;
  return {
    name: "リンク遷移確認",
    pass: failCount === 0,
    detail: failCount === 0 ? `${items.length}件すべて成功` : `${failCount}/${items.length}件が失敗`,
    items,
  };
}

async function checkFormSubmit(page, form, originUrl) {
  if (!form || !form.fields || !form.submit) {
    return { name: "フォーム送信確認", pass: true, detail: "チェック対象なし", items: [] };
  }

  const items = [];

  // フィールド入力
  for (const field of form.fields) {
    try {
      await page.getByLabel(field.label).fill(field.value);
      items.push({ target: `"${field.label}"`, pass: true, detail: `"${field.value}" を入力` });
    } catch (error) {
      items.push({ target: `"${field.label}"`, pass: false, detail: error.message });
    }
  }

  if (items.some((i) => !i.pass)) {
    const failCount = items.filter((i) => !i.pass).length;
    return {
      name: "フォーム送信確認",
      pass: false,
      detail: `フィールド入力に失敗 ${failCount}/${items.length}件`,
      items,
    };
  }

  // 送信ボタンをクリック
  try {
    const submitLocator = resolveLocator(page, form.submit).first();
    await submitLocator.click({ timeout: 5000 });
    items.push({ target: "送信ボタン", pass: true, detail: "クリック成功" });
  } catch (error) {
    items.push({ target: "送信ボタン", pass: false, detail: error.message });
    const failCount = items.filter((i) => !i.pass).length;
    return {
      name: "フォーム送信確認",
      pass: false,
      detail: `${failCount}/${items.length}件が失敗`,
      items,
    };
  }

  // 送信後の確認（text と url_contains は両方指定可能）
  if (form.expect) {
    if (form.expect.url_contains) {
      const passed = await page
        .waitForFunction((origin) => window.location.href !== origin, originUrl, { timeout: 5000 })
        .then(() => page.url().includes(form.expect.url_contains))
        .catch(() => false);
      items.push({
        target: "URL変化",
        pass: passed,
        detail: passed
          ? `"${form.expect.url_contains}" を含むURLに遷移`
          : `"${form.expect.url_contains}" を含むURLへの遷移なし`,
      });
    }

    if (form.expect.text) {
      const passed = await page
        .getByText(form.expect.text, { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      items.push({
        target: `"${form.expect.text}"`,
        pass: passed,
        detail: passed ? "テキスト表示を確認" : "テキストが表示されなかった",
      });
    }
  }

  const failCount = items.filter((i) => !i.pass).length;
  return {
    name: "フォーム送信確認",
    pass: failCount === 0,
    detail: failCount === 0 ? `${items.length}件すべて成功` : `${failCount}/${items.length}件が失敗`,
    items,
  };
}

module.exports = { checkHttpStatus, checkConsoleErrors, checkElementsExist, checkElementToggle, checkLinkNavigation, checkFormSubmit };
