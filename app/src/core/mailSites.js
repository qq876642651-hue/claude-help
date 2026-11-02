const fs = require('fs');
const { DATA_DIR, MAIL_SITES_FILE } = require('./paths');

// 预置：onet.yulishomes.com 支持的波兰邮箱后缀（取自该站 app.js 的 providerDomains）
const DEFAULT_MAIL_URL = 'https://onet.yulishomes.com/';
const DEFAULT_MAIL_DOMAINS = [
  'onet.pl', 'op.pl', 'onet.eu', 'poczta.onet.eu', 'vp.pl', 'autograf.pl', 'buziaczek.pl', 'amorki.pl',
  'wp.pl', 'o2.pl', 'tlen.pl', 'go2.pl',
  'interia.pl', 'interia.eu', 'poczta.fm', 'int.pl', '2gb.pl',
];

function defaultSites() {
  return DEFAULT_MAIL_DOMAINS.map((domain) => ({ domain, url: DEFAULT_MAIL_URL }));
}

function isWebUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeSites(list) {
  if (!Array.isArray(list)) return null;
  return list
    .map((s) => ({ domain: String(s.domain || '').trim().toLowerCase().replace(/^@/, ''), url: String(s.url || '').trim() }))
    .filter((s) => s.domain && isWebUrl(s.url));
}

function readMailSites() {
  try {
    const sites = normalizeSites(JSON.parse(fs.readFileSync(MAIL_SITES_FILE, 'utf8')).sites);
    if (sites) return sites;
  } catch {}
  return defaultSites();
}

function writeMailSites(list) {
  const sites = normalizeSites(list);
  if (!sites || sites.length !== list.length) throw new Error('每一行都要填后缀，网址要以 http:// 或 https:// 开头');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MAIL_SITES_FILE, JSON.stringify({ sites }, null, 2));
  return sites;
}

function addSite(domain, url) {
  const key = String(domain).trim().toLowerCase().replace(/^@/, '');
  const sites = readMailSites().filter((s) => s.domain !== key);
  sites.push({ domain: key, url });
  return writeMailSites(sites);
}

function removeSite(domain) {
  const key = String(domain).trim().toLowerCase().replace(/^@/, '');
  const sites = readMailSites();
  const kept = sites.filter((s) => s.domain !== key);
  if (kept.length === sites.length) throw new Error(`没有后缀 ${key} 的配置`);
  return writeMailSites(kept);
}

function resetSites() {
  try {
    fs.unlinkSync(MAIL_SITES_FILE);
  } catch {}
  return defaultSites();
}

function mailUrlFor(email) {
  const domain = String(email).split('@')[1];
  if (!domain) return null;
  const site = readMailSites().find((s) => s.domain === domain.toLowerCase());
  return site ? site.url : null;
}

module.exports = { readMailSites, writeMailSites, addSite, removeSite, resetSites, mailUrlFor, isWebUrl };
