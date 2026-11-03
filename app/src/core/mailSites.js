const fs = require('fs');
const { DATA_DIR, MAIL_SITES_FILE } = require('./paths');

function normalizeDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/^@/, '').replace(/^\./, '');
}

function isWebUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function checkSite(domain, url) {
  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) throw new Error(`后缀格式不对：${domain || '(空)'}，例如 poczta.onet.pl`);
  if (!isWebUrl(url)) throw new Error('网址要以 http:// 或 https:// 开头');
}

// 不预置网址：都由用户在软件或 CLI 里添加
function readMailSites() {
  try {
    const list = JSON.parse(fs.readFileSync(MAIL_SITES_FILE, 'utf8')).sites;
    if (Array.isArray(list)) {
      return list
        .map((s) => ({ domain: normalizeDomain(s.domain), url: String(s.url || '').trim() }))
        .filter((s) => s.domain && isWebUrl(s.url));
    }
  } catch {}
  return [];
}

function writeMailSites(sites) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MAIL_SITES_FILE, JSON.stringify({ sites }, null, 2));
  return sites;
}

function addSite(domain, url) {
  const key = normalizeDomain(domain);
  url = String(url || '').trim();
  checkSite(key, url);
  const sites = readMailSites().filter((s) => s.domain !== key);
  sites.push({ domain: key, url });
  return writeMailSites(sites);
}

// 原地修改一行；改了后缀时不能和别的行重复
function updateSite(oldDomain, domain, url) {
  const oldKey = normalizeDomain(oldDomain);
  const key = normalizeDomain(domain);
  url = String(url || '').trim();
  checkSite(key, url);
  const sites = readMailSites();
  const index = sites.findIndex((s) => s.domain === oldKey);
  if (index < 0) throw new Error(`没有后缀 ${oldKey} 的配置`);
  if (key !== oldKey && sites.some((s) => s.domain === key)) throw new Error(`后缀 ${key} 已经存在`);
  sites[index] = { domain: key, url };
  return writeMailSites(sites);
}

function removeSite(domain) {
  const key = normalizeDomain(domain);
  const sites = readMailSites();
  const kept = sites.filter((s) => s.domain !== key);
  if (kept.length === sites.length) throw new Error(`没有后缀 ${key} 的配置`);
  return writeMailSites(kept);
}

// 邮箱域名等于后缀，或以“.后缀”结尾都算匹配；多条匹配取最长的后缀
function findSite(email) {
  const domain = normalizeDomain(String(email).split('@')[1]);
  if (!domain) return null;
  let best = null;
  for (const s of readMailSites()) {
    if ((domain === s.domain || domain.endsWith('.' + s.domain)) && (!best || s.domain.length > best.domain.length)) best = s;
  }
  return best;
}

function mailUrlFor(email) {
  const site = findSite(email);
  return site ? site.url : null;
}

module.exports = { readMailSites, addSite, updateSite, removeSite, findSite, mailUrlFor, isWebUrl };
