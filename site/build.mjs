import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { content } from "./content.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const root = resolve(source, "..");
const output = resolve(source, "dist");
const project = JSON.parse(
  await readFile(resolve(source, "project.json"), "utf8"),
);
const desktop = JSON.parse(
  await readFile(resolve(root, "apps/desktop/package.json"), "utf8"),
);
const base = new URL(project.siteUrl);
if (base.protocol !== "https:" || !base.pathname.endsWith("/"))
  throw new Error("siteUrl must be an HTTPS directory URL");
if (project.buildVersion !== desktop.version)
  throw new Error("Review site/project.json for the current desktop version");
if (!/^\d{4}-\d{2}-\d{2}$/.test(project.reviewedAt))
  throw new Error("Invalid content review date");
// Only clean this generator's fixed output, after resolving its absolute boundary.
if (
  output !== resolve(root, "site", "dist") ||
  !output.startsWith(`${root}${sep}`)
)
  throw new Error("Unsafe output path");
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "assets"), { recursive: true });
await cp(resolve(source, "styles.css"), resolve(output, "assets/styles.css"));
await cp(
  resolve(root, "apps/desktop/src-tauri/icons/linux-512x512.png"),
  resolve(output, "assets/icon.png"),
);
await cp(
  resolve(root, "images/en-home-1.png"),
  resolve(output, "assets/dashboard.png"),
);
await cp(
  resolve(root, "assets/banners/cursor-byok/minimalist-en-1280x640.png"),
  resolve(output, "assets/social.png"),
);

const slugs = { home: "", guide: "guide/", accounts: "accounts/", faq: "faq/" };
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const url = (lang, page = "home") =>
  new URL(`${lang === "zh" ? "zh/" : ""}${slugs[page]}`, base).href;
const asset = (name) => new URL(`assets/${name}`, base).pathname;
const a = (href, label, classes = "") =>
  `<a${classes ? ` class="${classes}"` : ""} href="${esc(href)}">${esc(label)}</a>`;
const p = (text) => `<p>${esc(text)}</p>`;
const list = (items) =>
  `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
const cards = (items) =>
  `<div class="cards">${items.map(([title, text]) => `<article class="card"><h3>${esc(title)}</h3>${p(text)}</article>`).join("")}</div>`;
const note = (title, text) =>
  `<aside class="note"><h2>${esc(title)}</h2>${p(text)}</aside>`;
const pluginUrl = (provider) =>
  `${project.repository}/blob/main/server/plugins/build-in/${provider.plugin}/README.md`;
const releaseNotes = `${project.repository}/blob/main/support/releases/v${project.buildVersion}.md`;

function home(lang) {
  const c = content[lang],
    v = c.pages.home;
  return `<section class="hero">
    <div><p class="eyebrow">${esc(v.eyebrow)}</p><h1>${esc(v.heading)}</h1><p class="lead">${esc(v.intro)}</p>
    <div class="actions">${a(url(lang, "guide"), c.download, "button primary")}${a(project.repository, c.github, "button")}</div></div>
    <aside class="connection"><span class="connection-label">${esc(project.name)}</span><ol>${v.diagram.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>${p(v.diagramNote)}</aside>
  </section>
  <section><h2>${esc(v.featuresTitle)}</h2>${cards(v.features)}</section>
  <section class="split"><div><h2>${esc(v.providersTitle)}</h2>${p(v.providersIntro)}${a(url(lang, "accounts"), v.providersLink, "text-link")}</div>
    <div class="provider-links">${project.providers.map((provider) => a(`${url(lang, "accounts")}#${provider.id}`, provider.name)).join("")}</div></section>
  <section><h2>${esc(v.screenshotTitle)}</h2><figure class="screenshot"><img src="${asset("dashboard.png")}" width="2190" height="1442" loading="lazy" alt="${esc(lang === "zh" ? "Cursor BYOK 调用与用量界面示例" : "Cursor BYOK call and usage interface preview")}"><figcaption>${esc(v.screenshotCaption)}</figcaption></figure></section>
  ${note(v.scopeTitle, v.scope)}<p>${a(releaseNotes, v.scopeLink)}</p>
  <section class="closing"><h2>${esc(v.nextTitle)}</h2>${p(v.next)}${a(url(lang, "guide"), c.download, "button primary")}</section>`;
}

function guide(lang) {
  const c = content[lang],
    v = c.pages.guide;
  const expired =
    Date.now() >= Date.parse(`${project.buildExpiresAt}T23:59:59Z`);
  return `${intro(v)}
    <section id="downloads"><h2>${esc(v.downloadTitle)}</h2><div class="version-line"><span class="tag">${esc(v.build)} ${esc(project.buildVersion)}</span><span>${esc(v.release)} ${esc(project.publishedRelease)}</span></div>
    ${p(v.artifactNote)}<div class="downloads">${project.platforms.map((platform) => `<article class="download"><h3>${esc(platform.name)}</h3><p>${esc(platform.packages)}</p>${expired ? p(lang === "zh" ? "构建产物已过期，请查看源码构建或已发布版本。" : "Build artifact expired. Use a published release or build from source.") : a(platform.url, lang === "zh" ? "下载构建 ZIP" : "Download build ZIP", "button")}</article>`).join("")}</div>
    <p class="muted">${esc(v.expiry)} <time datetime="${esc(project.buildExpiresAt)}">${esc(project.buildExpiresAt)}</time>.</p>
    ${p(v.releaseNote)}${a(`${project.repository}/releases/tag/v${project.publishedRelease}`, `${v.releaseLink} v${project.publishedRelease}`, "text-link")}
    <p>${a(`${project.repository}/blob/main/support/fork-maintenance.md#build-from-source`, lang === "zh" ? "从源码构建当前版本" : "Build the current version from source")}</p></section>
    <section><h2>${esc(v.stepsTitle)}</h2><ol class="steps">${v.steps.map(([title, text]) => `<li><h3>${esc(title)}</h3>${p(text)}</li>`).join("")}</ol></section>
    <section><h2>${esc(v.protocolsTitle)}</h2>${cards(v.protocols)}${p(v.protocolsNote)}</section>
    ${note(v.troubleshootingTitle, v.troubleshooting)}
    <div class="actions">${a(url(lang, "accounts"), c.nav[2], "button")}${a(url(lang, "faq"), c.nav[3], "button")}</div>`;
}

function accounts(lang) {
  const c = content[lang],
    v = c.pages.accounts;
  return `${intro(v)}<nav class="jump-links" aria-label="${esc(c.nav[2])}">${project.providers.map((provider) => a(`#${provider.id}`, provider.name)).join("")}</nav>
    ${project.providers
      .map(
        (
          provider,
        ) => `<section class="provider" id="${provider.id}"><div class="provider-heading"><h2>${esc(provider.name)}</h2><span class="tag">${esc(project.buildVersion)}</span></div>
    <h3>${esc(v.requirement)}</h3>${p(v.providers[provider.id][0])}<h3>${esc(v.balance)}</h3>${p(v.providers[provider.id][1])}${a(pluginUrl(provider), c.source, "text-link")}</section>`,
      )
      .join("")}
    <section><h2>${esc(v.poolTitle)}</h2>${list(v.pool)}</section>
    <section><h2>${esc(v.existingTitle)}</h2>${p(v.existing)}<p>${["codex-auth", "antigravity-auth", "grok-auth"].map((plugin, index) => a(`${project.repository}/tree/main/server/plugins/build-in/${plugin}`, ["Codex", "Google Antigravity", "Grok"][index])).join(" · ")}</p></section>
    ${note(v.validationTitle, v.validation)}<p>${a(releaseNotes, c.source)}</p>`;
}

function faq(lang) {
  const c = content[lang],
    v = c.pages.faq;
  return `${intro(v)}<nav class="question-index" aria-label="${esc(c.nav[3])}">${v.items.map(([id, question]) => a(`#${id}`, question)).join("")}</nav>
    <div class="answers">${v.items.map(([id, question, answer]) => `<section id="${id}"><h2>${a(`#${id}`, question)}</h2>${p(answer)}</section>`).join("")}</div>
    <div class="actions">${a(url(lang, "guide"), c.download, "button primary")}${a(url(lang, "accounts"), c.nav[2], "button")}</div>
    <p>${a(releaseNotes, c.source)} · ${a(`${project.repository}/issues`, "GitHub Issues")}</p>`;
}

function intro(page) {
  return `<header class="page-intro"><h1>${esc(page.heading)}</h1><p class="lead">${esc(page.intro)}</p></header>`;
}

function graph(lang, page) {
  const current = url(lang, page),
    c = content[lang];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base.href}#website`,
        name: project.name,
        url: base.href,
        inLanguage: ["en", "zh-Hans"],
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${base.href}#software`,
        name: project.name,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Windows, macOS, Linux",
        url: base.href,
        description: content.en.pages.home.description,
        isBasedOn: project.upstream,
        softwareVersion: project.buildVersion,
        maintainer: {
          "@type": "Person",
          name: project.maintainer,
          url: `https://github.com/${project.maintainer}`,
        },
        releaseNotes,
        downloadUrl: url("en", "guide"),
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${base.href}#source`,
        name: `${project.name} (bargino community fork)`,
        codeRepository: project.repository,
        programmingLanguage: ["Rust", "TypeScript"],
        license: `${project.repository}/blob/main/LICENSE`,
        isBasedOn: project.upstream,
      },
      {
        "@type": "WebPage",
        "@id": `${current}#page`,
        url: current,
        name: c.pages[page].title,
        description: c.pages[page].description,
        inLanguage: c.language,
        dateModified: project.reviewedAt,
        isPartOf: { "@id": `${base.href}#website` },
        about: { "@id": `${base.href}#software` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: (page === "home"
          ? [[c.nav[0], url(lang)]]
          : [
              [c.nav[0], url(lang)],
              [c.nav[Object.keys(slugs).indexOf(page)], current],
            ]
        ).map(([name, item], index) => ({
          "@type": "ListItem",
          position: index + 1,
          name,
          item,
        })),
      },
    ],
  };
}

function document(lang, page, body, noindex = false) {
  const c = content[lang],
    v = c.pages[page],
    other = lang === "zh" ? "en" : "zh";
  return `<!doctype html>
<html lang="${c.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.title)}</title><meta name="description" content="${esc(v.description)}"><meta name="author" content="${esc(project.maintainer)}">
<meta name="robots" content="${noindex ? "noindex,follow" : "index,follow,max-image-preview:large"}">
<link rel="canonical" href="${url(lang, page)}"><link rel="alternate" hreflang="en" href="${url("en", page)}"><link rel="alternate" hreflang="zh-Hans" href="${url("zh", page)}"><link rel="alternate" hreflang="x-default" href="${url("en", page)}">
<link rel="icon" type="image/png" href="${asset("icon.png")}"><link rel="stylesheet" href="${asset("styles.css")}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(project.name)}"><meta property="og:title" content="${esc(v.title)}"><meta property="og:description" content="${esc(v.description)}"><meta property="og:url" content="${url(lang, page)}"><meta property="og:locale" content="${lang === "zh" ? "zh_CN" : "en_US"}">
<meta property="og:image" content="${new URL("assets/social.png", base).href}"><meta property="og:image:width" content="1280"><meta property="og:image:height" content="640"><meta property="og:image:alt" content="Cursor BYOK: your models and account pools in Cursor">
<meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(graph(lang, page)).replaceAll("<", "\\u003c")}</script>
</head><body><a class="skip" href="#main">${esc(c.skip)}</a>
<header class="site-header"><div class="header-inner"><a class="brand" href="${url(lang)}"><img src="${asset("icon.png")}" width="38" height="38" alt=""><span>${esc(project.name)}</span></a>
<nav aria-label="${lang === "zh" ? "主导航" : "Main navigation"}">${Object.keys(
    slugs,
  )
    .map(
      (key, index) =>
        `<a href="${url(lang, key)}"${key === page && !noindex ? ' aria-current="page"' : ""}>${esc(c.nav[index])}</a>`,
    )
    .join("")}</nav>
<div class="header-actions"><a class="language" href="${url(other, page)}" lang="${content[other].language}">${esc(c.alternateName)}</a>${a(project.repository, "GitHub", "repo-link")}</div></div></header>
<main id="main" class="container">${body}<p class="reviewed">${esc(c.reviewed)}: <time datetime="${esc(project.reviewedAt)}">${esc(project.reviewedAt)}</time> · ${a(new URL("project.json", base).href, lang === "zh" ? "项目资料 JSON" : "Project facts JSON")}</p></main>
<footer><div class="container footer-inner"><div><strong>${esc(project.name)}</strong>${p(c.fork)}<p>${a(project.upstream, "leookun/cursor-byok")} · ${a(project.repository, "bargino/cursor-byok")}</p></div>
<div>${p(c.independent)}${p(c.feedback)}<p>${a(`${project.repository}/issues`, "GitHub Issues")} · ${a(`${project.repository}/blob/main/LICENSE`, "MIT / plugin licenses")} · ${a(new URL("sitemap.xml", base).href, "Sitemap")}</p></div><p class="star">${a(project.repository, c.star)}</p></div></footer></body></html>\n`;
}

const renderers = { home, guide, accounts, faq };
const pages = [];
for (const lang of ["en", "zh"]) {
  for (const [page, render] of Object.entries(renderers)) {
    const relative = `${lang === "zh" ? "zh/" : ""}${slugs[page]}`;
    await mkdir(resolve(output, relative), { recursive: true });
    await writeFile(
      resolve(output, relative, "index.html"),
      document(lang, page, render(lang)),
    );
    pages.push({ lang, page, url: url(lang, page) });
  }
}
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${pages.map(({ page, url: current }) => `<url><loc>${esc(current)}</loc><lastmod>${project.reviewedAt}</lastmod>${["en", "zh", "x-default"].map((lang) => `<xhtml:link rel="alternate" hreflang="${lang === "zh" ? "zh-Hans" : lang}" href="${url(lang === "x-default" ? "en" : lang, page)}"/>`).join("")}</url>`).join("")}</urlset>\n`;
await writeFile(resolve(output, "sitemap.xml"), sitemap);
await writeFile(
  resolve(output, "project.json"),
  `${JSON.stringify(project, null, 2)}\n`,
);
await writeFile(resolve(output, ".nojekyll"), "");
await writeFile(
  resolve(output, "llms.txt"),
  `# Cursor BYOK\n\n> An independent community-maintained desktop model gateway for Cursor. Repository: ${project.repository}\n\nUse the linked documentation for version-specific setup and limits. The 1.0.4 account-plugin build differs from the published 1.0.3 release; live-account validation remains pending.\n\n## Documentation\n\n${pages.map(({ lang, page, url: current }) => `- [${content[lang].pages[page].title}](${current})`).join("\n")}\n\n## Source\n\n- [Project facts](${new URL("project.json", base).href})\n- [Source and issue tracker](${project.repository})\n- [Upstream project](${project.upstream})\n`,
);
await writeFile(
  resolve(output, "404.html"),
  document(
    "en",
    "home",
    '<section class="page-intro"><h1>Page not found.</h1><p>This address does not match a documentation page. Use the navigation to find setup instructions or account information.</p></section>',
    true,
  ),
);
console.log(`Built ${pages.length} static documentation pages at ${base.href}`);
