#!/usr/bin/env node
'use strict';

/**
 * jike-daily-archive.js
 *
 * Deterministic daily archive runner for JikeScraper.
 * It calls the local JikePlugin stdio entry, collects recommend/search feeds,
 * de-duplicates posts, and writes data/daily-archive/YYYY-MM-DD-jike-feeds.json.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_DIR = __dirname;
const JIKE_PLUGIN = path.join(PLUGIN_DIR, 'JikePlugin.js');
const ARCHIVE_DIR = path.join(PLUGIN_DIR, 'data', 'daily-archive');

const DEFAULT_KEYWORDS = ['AI', '科技', '开源', '互联网', 'Agent'];
const DEFAULT_RECOMMEND_COUNT = Number(process.env.JIKE_ARCHIVE_RECOMMEND_COUNT || 15);
const DEFAULT_SEARCH_COUNT = Number(process.env.JIKE_ARCHIVE_SEARCH_COUNT || 12);
const DEFAULT_CONTENT_LIMIT = Number(process.env.JIKE_ARCHIVE_CONTENT_LIMIT || 1200);

function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 3600 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function callJikePlugin(payload) {
  const child = spawnSync(process.execPath, [JIKE_PLUGIN], {
    cwd: PLUGIN_DIR,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });

  if (child.error) throw child.error;

  const stdout = (child.stdout || '').trim();
  const stderr = (child.stderr || '').trim();

  if (child.status !== 0 && !stdout) {
    throw new Error(`JikePlugin exited with code ${child.status}: ${stderr}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new Error(`Failed to parse JikePlugin stdout: ${err.message}; stdout=${stdout.slice(0, 500)}; stderr=${stderr.slice(0, 500)}`);
  }

  if (parsed.status !== 'success') {
    throw new Error(parsed.error || `JikePlugin returned non-success for action ${payload.action}`);
  }

  return parsed.result || {};
}

function normalizeItem(raw, source) {
  if (!raw || typeof raw !== 'object') return null;

  const id = raw.id || raw.postId || raw.targetId || '';
  const content = raw.content || raw.text || raw.title || '';
  if (!id || !content) return null;

  // Search can return topic/user entries even when search_type=post. Keep only post-like items.
  if (raw.type && raw.type !== 'post' && !raw.createdAt) return null;

  const topics = Array.isArray(raw.topics)
    ? raw.topics.filter(Boolean)
    : (raw.topicName ? [raw.topicName] : []);

  return {
    id,
    content,
    username: raw.username || '',
    nickname: raw.nickname || '',
    createdAt: raw.createdAt || raw.created_at || '',
    likeCount: Number(raw.likeCount || raw.likedCount || 0),
    commentCount: Number(raw.commentCount || raw.commentsCount || 0),
    topicId: raw.topicId || '',
    topicName: raw.topicName || '',
    topics,
    url: raw.url || `https://web.okjike.com/post/${id}`,
    source,
    archivedAt: new Date().toISOString(),
  };
}

function addItems(target, seen, items, source) {
  let added = 0;
  for (const raw of items || []) {
    const item = normalizeItem(raw, source);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    target.push(item);
    added++;
  }
  return added;
}

function compactSourceSummary(sources) {
  const byType = new Map();
  const byKeyword = new Map();

  for (const s of sources) {
    const type = s.type === 'recommend' ? 'recommend' : 'search';
    byType.set(type, (byType.get(type) || 0) + s.count);

    if (s.keyword) {
      byKeyword.set(s.keyword, (byKeyword.get(s.keyword) || 0) + s.count);
    }
  }

  return {
    sourcesByType: Array.from(byType, ([type, count]) => ({ type, count })),
    sourcesByKeyword: Array.from(byKeyword, ([type, count]) => ({ type, count })),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const date = String(args.date || process.env.JIKE_ARCHIVE_DATE || localDate());
  const keywords = String(args.keywords || process.env.JIKE_ARCHIVE_KEYWORDS || DEFAULT_KEYWORDS.join(','))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const outputFile = path.join(ARCHIVE_DIR, `${date}-jike-feeds.json`);
  const items = [];
  const seen = new Set();
  const sources = [];
  const errors = [];

  try {
    const recommend = callJikePlugin({
      action: 'get_recommend_feeds',
      count: String(DEFAULT_RECOMMEND_COUNT),
      compact: false,
      content_limit: String(DEFAULT_CONTENT_LIMIT),
    });
    const recommendItems = recommend.items || recommend.results || [];
    const count = addItems(items, seen, recommendItems, { type: 'recommend' });
    sources.push({ type: 'recommend', count });
  } catch (err) {
    errors.push({ type: 'recommend', error: err.message });
  }

  for (const keyword of keywords) {
    try {
      const result = callJikePlugin({
        action: 'search',
        keyword,
        search_type: 'post',
        count: String(DEFAULT_SEARCH_COUNT),
        compact: false,
        content_limit: String(DEFAULT_CONTENT_LIMIT),
      });
      const resultItems = result.items || result.results || [];
      const count = addItems(items, seen, resultItems, { type: 'search', keyword });
      sources.push({ type: `search:${keyword}`, count });
    } catch (err) {
      errors.push({ type: 'search', keyword, error: err.message });
    }
  }

  items.sort((a, b) => {
    const scoreA = (a.likeCount || 0) * 2 + (a.commentCount || 0) * 3;
    const scoreB = (b.likeCount || 0) * 2 + (b.commentCount || 0) * 3;
    return scoreB - scoreA;
  });

  const summaries = compactSourceSummary(sources);
  const archive = {
    date,
    generatedAt: new Date().toISOString(),
    file: outputFile,
    totalItems: items.length,
    sources,
    sourcesByType: summaries.sourcesByType,
    sourcesByKeyword: summaries.sourcesByKeyword,
    errors,
    items,
  };

  writeJsonAtomic(outputFile, archive);

  const result = {
    date,
    file: outputFile,
    totalItems: items.length,
    sources,
    sourcesByType: summaries.sourcesByType,
    sourcesByKeyword: summaries.sourcesByKeyword,
    errors,
  };

  console.log(JSON.stringify({ status: 'success', result }));
}

try {
  main();
} catch (err) {
  console.error('[jike-daily-archive]', err && err.stack ? err.stack : err);
  console.log(JSON.stringify({ status: 'error', error: String(err && err.message ? err.message : err) }));
  process.exit(1);
}