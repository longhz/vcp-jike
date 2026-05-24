/**
 * JikeScraper - VCPToolBox 即刻插件
 * 
 * 协议: stdio (VCP Plugin)
 * 输入: JSON from stdin  { action, ...args }
 * 输出: JSON to stdout    { status: "success"|"error", result/error }
 * 
 * 登录态: 使用 ~/.hermes/skills/jike-scrape/src/tokens.json
 * 初次使用前需运行 jike-setup.js 完成扫码登录
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// --- 1. 配置 ---
const PLUGIN_DIR = __dirname;
// tokens.json 路径优先级：1. 环境变量 2. 插件目录 3. skill 目录（备用）
const SKILL_TOKENS_PATH = path.join(process.env.HOME || '/root', '.hermes/skills/jike-scrape/src/tokens.json');
const TOKENS_PATH = process.env.JikeTokensPath
  || path.join(PLUGIN_DIR, 'tokens.json');
const API_BASE = process.env.JikeApiBase || 'https://api.ruguoapp.com';
const WEB_ORIGIN = process.env.JikeWebOrigin || 'https://web.okjike.com';
const DEFAULT_COUNT = parseInt(process.env.JikeDefaultCount || '25', 10);
const PROXY_URL = process.env.JikeProxyUrl || null;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// --- 2. 工具函数 ---
const log = (...args) => console.error('[JikeScraper]', new Date().toISOString(), ...args);

const sendResponse = (data) => {
  console.log(JSON.stringify(data));
  process.exit(0);
};

const sendError = (msg) => {
  log('Error:', msg);
  console.log(JSON.stringify({ status: 'error', error: String(msg) }));
  process.exit(0);
};

const expandPath = (p) => p.replace(/^~/, process.env.HOME || '/root');

const jikeRequest = (method, endpoint, token = '', body = null, extraHeaders = {}) => {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_BASE);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Origin': WEB_ORIGIN,
      'Referer': WEB_ORIGIN + '/',
      'User-Agent': UA,
      'Accept': 'application/json',
      ...(token ? { 'x-jike-access-token': token } : {}),
      ...extraHeaders,
    };

    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
    };

    const req = lib.request(reqOptions, (res) => {
      const headers = res.headers;
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers, data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

// --- 3. Token 管理 ---
const loadTokens = () => {
  try {
    // 优先加载插件目录的 token
    let content;
    if (fs.existsSync(expandPath(TOKENS_PATH))) {
      content = fs.readFileSync(expandPath(TOKENS_PATH), 'utf-8');
      const tokens = JSON.parse(content);
      // 如果插件 token 缺少 username，尝试用 skill 的 token
      if (!tokens.username && fs.existsSync(expandPath(SKILL_TOKENS_PATH))) {
        const skillTokens = JSON.parse(fs.readFileSync(expandPath(SKILL_TOKENS_PATH), 'utf-8'));
        tokens.username = skillTokens.username || '';
        tokens.access_token = tokens.access_token || skillTokens.access_token || '';
        tokens.refresh_token = tokens.refresh_token || skillTokens.refresh_token || '';
      }
      return tokens;
    }
    // 插件 token 不存在，尝试 skill 目录
    if (fs.existsSync(expandPath(SKILL_TOKENS_PATH))) {
      return JSON.parse(fs.readFileSync(expandPath(SKILL_TOKENS_PATH), 'utf-8'));
    }
    return null;
  } catch { return null; }
};

const saveTokens = (tokens) => {
  const dir = path.dirname(expandPath(TOKENS_PATH));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(expandPath(TOKENS_PATH), JSON.stringify(tokens, null, 2));
};

const refreshToken = async (refresh_token) => {
  if (!refresh_token) return false;
  try {
    log('使用 refresh_token 刷新 access_token...');
    // 即刻刷新接口是 GET /app_auth_tokens.refresh，refresh_token 在 header 里
    // 新 token 既在响应头 x-jike-access-token，也在 body 里
    const res = await jikeRequest('GET', '/app_auth_tokens.refresh', '', null, {
      'x-jike-refresh-token': refresh_token,
    });
    // 优先从响应头读（更可靠），fallback 到 body
    const newAccessToken = res.headers?.['x-jike-access-token'] || res.data?.['x-jike-access-token'];
    if (res.status === 200 && newAccessToken) {
      const newTokens = {
        access_token: newAccessToken,
        refresh_token: refresh_token, // 保留原 refresh_token（刷新后旧 token 仍可用）
        username: res.data?.username || '',
      };
      saveTokens(newTokens);
      log('Token 刷新成功');
      return true;
    }
    log('刷新失败，响应状态:', res.status);
    return false;
  } catch (e) {
    log('刷新异常:', e.message);
    return false;
  }
};

// 带 token 的 API 调用，自动处理 401
const apiCall = async (method, endpoint, body = null, retryCount = 0) => {
  const tokens = loadTokens();
  if (!tokens || !tokens.access_token) {
    throw new Error('未登录或 tokens.json 不存在。请先运行 jike-setup.js 完成扫码登录。');
  }

  const res = await jikeRequest(method, endpoint, tokens.access_token, body);

  if (res.status === 401 && retryCount === 0 && tokens.refresh_token) {
    log('Token 过期，尝试刷新...');
    const ok = await refreshToken(tokens.refresh_token);
    if (ok) {
      return apiCall(method, endpoint, body, 1);
    }
    throw new Error('Token 已过期，请重新运行 jike-setup.js 登录。');
  }

  if (res.status >= 400) {
    throw new Error(`API 错误 ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
  }

  return res.data;
};

// --- 4. Action 实现 ---

// 检查登录状态
const actionCheckLoginStatus = async () => {
  const tokens = loadTokens();
  if (!tokens || !tokens.access_token) {
    return { loggedIn: false, message: '未登录' };
  }
  try {
    const data = await apiCall('GET', '/1.0/users/profile?username=');
    const user = data?.user;
    if (user?.username) {
      return {
        loggedIn: true,
        username: user.username,
        nickname: user.nickname || user.screenName || '',
        followersCount: user.followersCount || 0,
        followingCount: user.followingCount || 0,
      };
    }
  } catch (e) {
    log('检查登录失败:', e.message);
  }
  return { loggedIn: false, message: 'Token 可能已失效' };
};

// 搜索（支持类型过滤：user / post / topic）
const actionSearch = async ({ keyword, count, search_type, compact, content_limit }) => {
  if (!keyword) throw new Error('keyword 参数必填');
  const limit = Math.min(parseInt(count || '12', 10), 15); // Hard cap at 15
  const typeMap = { user: 'USER', post: 'POST', topic: 'TOPIC' };
  const apiType = (search_type && typeMap[search_type.toLowerCase()]) || 'ALL';
  const data = await apiCall('POST', '/1.0/search/integrate', {
    keywords: keyword,
    type: apiType,
    ...(limit ? { limit } : {}),
  });
  return formatSearchResults(data, keyword, {
    compact: compact === 'true' || compact === true,
    contentLimit: parseInt(content_limit || '300', 10),
    maxResults: limit,
  });
};

// 用户帖子（支持昵称或ID，支持自动翻页）
const actionGetUserPosts = async ({ username, count, load_more_key, max_posts }) => {
  if (!username) throw new Error('username 参数必填');
  const uid = await resolveUsernameAsync(username);
  const limit = parseInt(count || DEFAULT_COUNT, 10);
  const MAX_POSTS = parseInt(max_posts || '0', 10);

  // 不需要自动翻页时（默认行为，向后兼容）
  if (!MAX_POSTS) {
    const body = { username: uid, limit };
    if (load_more_key) {
      body.loadMoreKey = typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key;
    }
    const data = await apiCall('POST', '/1.0/personalUpdate/single', body);
    return formatFeed(data);
  }

  // 自动翻页模式
  const allPosts = [];
  let nextKey = load_more_key
    ? (typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key)
    : null;
  let page = 0;
  const MAX_PAGES = Math.ceil(MAX_POSTS / limit) + 2;
  let lastLoadMoreKey = null;

  while (page < MAX_PAGES && allPosts.length < MAX_POSTS) {
    page++;
    const body = { username: uid, limit };
    if (nextKey) body.loadMoreKey = nextKey;

    const data = await apiCall('POST', '/1.0/personalUpdate/single', body);
    const posts = data?.data || [];
    if (posts.length === 0) break;

    for (const p of posts) {
      allPosts.push(formatPost(p));
    }

    if (!data?.loadMoreKey) { lastLoadMoreKey = null; break; }
    lastLoadMoreKey = data.loadMoreKey;
    if (allPosts.length >= MAX_POSTS) break;
    nextKey = typeof data.loadMoreKey === 'string' ? JSON.parse(data.loadMoreKey) : data.loadMoreKey;
  }

  const truncated = allPosts.length >= MAX_POSTS && lastLoadMoreKey !== null;
  const result = { posts: allPosts.slice(0, MAX_POSTS), total: Math.min(allPosts.length, MAX_POSTS), truncated };

  if (truncated) {
    result.message = `已获取 ${MAX_POSTS} 条帖子（上限），还有更多内容。传入 load_more_key 继续获取。`;
    result.load_more_key = typeof lastLoadMoreKey === 'string' ? lastLoadMoreKey : JSON.stringify(lastLoadMoreKey);
  }

  log(`用户 ${uid}: 获取 ${result.total} 条帖子 (${page}页)${truncated ? ' [已截断]' : ''}`);
  return result;
};

// 关注动态（支持翻页）
const actionGetFollowingFeeds = async ({ load_more_key }) => {
  const body = {};
  if (load_more_key) {
    body.loadMoreKey = typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key;
  }
  const data = await apiCall('POST', '/1.0/personalUpdate/followingUpdates', body);
  return formatFeed(data);
};

// 推荐动态（支持翻页）
const actionGetRecommendFeeds = async ({ load_more_key }) => {
  const body = {};
  if (load_more_key) {
    body.loadMoreKey = typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key;
  }
  const data = await apiCall('POST', '/1.0/recommendFeed/list', body);
  return formatFeed(data);
};

// 圈子动态
const actionGetTopicFeed = async ({ topic_id, load_more_key }) => {
  if (!topic_id) throw new Error('topic_id 参数必填');
  const body = { topicId: topic_id, ...parseLoadMoreKey(load_more_key) };
  const data = await apiCall('POST', '/1.0/topicFeed/list', body);
  return formatFeed(data);
};

// 帖子详情
const actionGetPostDetail = async ({ post_id, post_type }) => {
  if (!post_id) throw new Error('post_id 参数必填');
  const type = post_type || 'ORIGINAL_POST';
  const path = type === 'REPOST' ? `/1.0/reposts/get?id=${post_id}` : `/1.0/originalPosts/get?id=${post_id}`;
  const data = await apiCall('GET', path);
  return formatPost(data?.data || data);
};

// 评论列表
const actionGetComments = async ({ post_id, target_type, load_more_key }) => {
  if (!post_id) throw new Error('post_id 参数必填');
  const type = target_type || 'ORIGINAL_POST';
  const body = { targetId: post_id, targetType: type };
  if (load_more_key) {
    body.loadMoreKey = typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key;
  }
  const data = await apiCall('POST', '/1.0/comments/listPrimary', body);
  return formatComments(data);
};

// 帖子详情 + 全部评论（自动翻页，可选楼中楼）
const actionGetPostWithComments = async ({ post_id, post_type, max_comments, load_more_key, include_replies }) => {
  if (!post_id) throw new Error('post_id 参数必填');
  const type = post_type || 'ORIGINAL_POST';
  const MAX_COMMENTS = parseInt(max_comments || '150', 10);
  const MAX_PAGES = Math.ceil(MAX_COMMENTS / DEFAULT_COUNT) + 2;
  const wantReplies = include_replies === 'true' || include_replies === true;

  // 1. 获取帖子详情
  const detailPath = type === 'REPOST'
    ? `/1.0/reposts/get?id=${post_id}`
    : `/1.0/originalPosts/get?id=${post_id}`;
  const postData = await apiCall('GET', detailPath);
  const post = formatPost(postData?.data || postData);

  // 2. 自动翻页获取评论
  const allComments = [];
  const seenIds = new Set();
  let nextLoadMoreKey = load_more_key
    ? (typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key)
    : null;
  let page = 0;
  let lastLoadMoreKey = null;

  while (page < MAX_PAGES) {
    page++;
    const body = {
      targetId: post_id,
      targetType: type,
    };
    if (nextLoadMoreKey) {
      body.loadMoreKey = nextLoadMoreKey;
    }

    const data = await apiCall('POST', '/1.0/comments/listPrimary', body);
    const comments = data?.data || [];

    if (comments.length === 0) break;

    for (const c of comments) {
      const cid = c?.id || c?.['_id'] || '';
      if (seenIds.has(cid)) continue; // 去重保护
      seenIds.add(cid);
      allComments.push({
        id: cid,
        content: c?.content || c?.text || '',
        username: c?.user?.username || '',
        nickname: c?.user?.nickname || c?.user?.screenName || '',
        createdAt: c?.createdAt || c?.created_at || '',
        likeCount: c?.likedCount || c?.likeCount || 0,
      });
    }

    // 没有下一页
    if (!data?.loadMoreKey) {
      lastLoadMoreKey = null;
      break;
    }

    lastLoadMoreKey = data.loadMoreKey;

    // 已达上限，停止翻页
    if (allComments.length >= MAX_COMMENTS) {
      break;
    }

    // 将API返回的loadMoreKey直接作为下一页的参数
    nextLoadMoreKey = typeof data.loadMoreKey === 'string'
      ? JSON.parse(data.loadMoreKey)
      : data.loadMoreKey;
  }

  const truncated = allComments.length >= MAX_COMMENTS && lastLoadMoreKey !== null;

  // 楼中楼：对有子回复的评论获取回复
  if (wantReplies) {
    const REPLY_LIMIT = 5; // 每条评论最多拉5条子回复
    for (const comment of allComments) {
      try {
        const replyData = await apiCall('POST', '/1.0/comments/listMore', {
          targetId: comment.id,
          targetType: 'COMMENT',
        });
        const replies = replyData?.data || [];
        if (replies.length > 0) {
          comment.replies = replies.slice(0, REPLY_LIMIT).map(r => ({
            id: r?.id || '',
            content: r?.content || r?.text || '',
            nickname: r?.user?.nickname || r?.user?.screenName || '',
            createdAt: r?.createdAt || '',
            likeCount: r?.likedCount || r?.likeCount || 0,
          }));
        }
      } catch (e) {
        // 子回复获取失败不影响主流程
      }
    }
  }

  log(`帖子 ${post_id}: 获取 ${allComments.length} 条评论 (${page}页)${truncated ? ' [已截断]' : ''}${wantReplies ? ' [含楼中楼]' : ''}`);

  const result = {
    post,
    comments: {
      total: allComments.length,
      truncated,
      items: allComments,
    },
  };

  if (truncated) {
    const nextKey = typeof lastLoadMoreKey === 'string'
      ? lastLoadMoreKey
      : JSON.stringify(lastLoadMoreKey);
    result.comments.message = `已获取 ${allComments.length} 条评论（上限 ${MAX_COMMENTS}），还有更多内容。传入 load_more_key 继续获取剩余评论。`;
    result.comments.load_more_key = nextKey;
  }

  return result;
};

// 用户资料（支持昵称或ID）
const actionGetUserProfile = async ({ username }) => {
  if (!username) throw new Error('username 参数必填');
  const uid = await resolveUsernameAsync(username);
  const data = await apiCall('GET', `/1.0/users/profile?username=${encodeURIComponent(uid)}`);
  const user = data?.user || data || {};
  return {
    username: user.username || uid,
    nickname: user.nickname || user.screenName || '',
    bio: user.briefIntro || user.bio || '',
    followersCount: user.followersCount || 0,
    followingCount: user.followingCount || 0,
    postsCount: user.postsCount || 0,
    likedCount: user.likedCount || 0,
    avatarUrl: user.avatarImage || user.avatarUrl || '',
    isFollowing: user.isFollowing || false,
  };
};

// 发帖
const actionCreatePost = async ({ content, topic_id }) => {
  if (!content) throw new Error('content 参数必填');
  const body = { content };
  if (topic_id) body.topicId = topic_id;
  const data = await apiCall('POST', '/1.0/originalPosts/create', body);
  const post = data?.data || data;
  return {
    postId: post.id || post['_id'] || '',
    content: post.content || post.text || '',
    createdAt: post.createdAt || post.created_at || '',
  };
};

// 评论
const actionAddComment = async ({ post_id, content, target_type }) => {
  if (!post_id || !content) throw new Error('post_id 和 content 参数必填');
  const type = target_type || 'ORIGINAL_POST';
  const data = await apiCall('POST', '/1.0/comments/add', {
    targetId: post_id,
    targetType: type,
    content,
  });
  const comment = data?.data || data;
  return {
    commentId: comment.id || comment['_id'] || '',
    content: comment.content || comment.text || '',
    createdAt: comment.createdAt || comment.created_at || '',
  };
};

// 点赞
const actionLikePost = async ({ post_id, target_type }) => {
  if (!post_id) throw new Error('post_id 参数必填');
  const type = target_type || 'ORIGINAL_POST';
  await apiCall('POST', '/1.0/likes/save', { targetId: post_id, targetType: type });
  return { postId: post_id, liked: true };
};

// 取消点赞
const actionUnlikePost = async ({ post_id, target_type }) => {
  if (!post_id) throw new Error('post_id 参数必填');
  const type = target_type || 'ORIGINAL_POST';
  await apiCall('POST', '/1.0/likes/remove', { targetId: post_id, targetType: type });
  return { postId: post_id, liked: false };
};

// 关注用户（支持昵称或ID）
const actionFollowUser = async ({ username }) => {
  if (!username) throw new Error('username 参数必填');
  const uid = await resolveUsernameAsync(username);
  await apiCall('POST', '/1.0/userRelation/follow', { username: uid });
  return { username: uid, following: true };
};

// 取消关注（支持昵称或ID）
const actionUnfollowUser = async ({ username }) => {
  if (!username) throw new Error('username 参数必填');
  const uid = await resolveUsernameAsync(username);
  await apiCall('POST', '/1.0/userRelation/unfollow', { username: uid });
  return { username: uid, following: false };
};

// --- 4e. 获取我的圈子 ---
// API: POST /1.0/topics/listSubscribed
// 分页特点: 每页只有1个圈子，用顺序整数 str(page) 翻页
const actionGetMyTopics = async () => {
  const tokens = loadTokens();
  if (!tokens || !tokens.access_token) {
    throw new Error('未登录或 tokens.json 不存在');
  }

  const username = tokens.username || '';
  if (!username) {
    throw new Error('tokens.json 中缺少 username，请重新登录');
  }

  const allTopics = [];
  let page = 0;
  const MAX_PAGES = 120;

  while (true) {
    page++;
    const body = page === 1
      ? { username }
      : { username, loadMoreKey: String(page) };

    const data = await apiCall('POST', '/1.0/topics/listSubscribed', body);

    const items = data?.data || [];
    if (items.length === 0) break;

    for (const item of items) {
      allTopics.push({
        topicId: item.id || item.topicId || '',
        name: item.content || item.name || '',
        briefIntro: item.briefIntro || null,
        topicType: item.topicType || 'OFFICIAL',
        subscribersCount: item.subscribersCount || 0,
        subscribedAt: item.subscribedAt || '',
        squarePictureUrl: item.squarePictureUrl || '',
        messagePrefix: item.messagePrefix || '',
        intro: item.intro || item.briefIntro || '',
      });
    }

    // 如果没有 loadMoreKey 了，说明到最后一页
    if (!data?.loadMoreKey) break;

    if (page >= MAX_PAGES) {
      log(`达到最大页数限制 ${MAX_PAGES}，停止翻页`);
      break;
    }
  }

  log(`共获取 ${allTopics.length} 个圈子`);

  // 完整数据
  const fullData = {
    username,
    fetchedAt: new Date().toISOString(),
    total: allTopics.length,
    topics: allTopics,
  };

  // 摘要数据
  const officialTopics = allTopics.filter(t => t.topicType === 'OFFICIAL');
  const userTopics = allTopics.filter(t => t.topicType === 'USER');
  const sortedByPopularity = [...allTopics].sort((a, b) => (b.subscribersCount || 0) - (a.subscribersCount || 0));
  const topInterests = sortedByPopularity.slice(0, 30).map(t => t.name);

  const summaryData = {
    user: username,
    fetchedAt: fullData.fetchedAt,
    total: allTopics.length,
    byType: {
      official: officialTopics.length,
      user: userTopics.length,
    },
    topInterests,
    allTopics: allTopics.map(t => ({
      topicId: t.topicId,
      name: t.name,
      briefIntro: t.briefIntro,
    })),
  };

  // 持久化到 data/ 子目录
  const dataDir = path.join(PLUGIN_DIR, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const fullPath = path.join(dataDir, 'jike-my-topics.json');
  const summaryPath = path.join(dataDir, 'jike-my-topics-summary.json');

  fs.writeFileSync(fullPath, JSON.stringify(fullData, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));

  log(`数据已保存: ${fullPath} (${allTopics.length} 条)`);

  return {
    total: allTopics.length,
    byType: summaryData.byType,
    topInterests,
    fetchedAt: fullData.fetchedAt,
    savedTo: { full: fullPath, summary: summaryPath },
  };
};

const actionReadMyTopics = async ({ type }) => {
  const dataDir = path.join(PLUGIN_DIR, 'data');
  const filePath = path.join(dataDir, type === 'summary' ? 'jike-my-topics-summary.json' : 'jike-my-topics.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`数据文件不存在: ${filePath}，请先调用 get_my_topics`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
};

// --- 5. 辅助函数 ---

const parseLoadMoreKey = (load_more_key) => {
  if (!load_more_key) return {};
  try {
    const key = typeof load_more_key === 'string' ? JSON.parse(load_more_key) : load_more_key;
    return key && typeof key === 'object' ? key : {};
  } catch { return {}; }
};

const formatFeed = (data) => {
  const items = data?.data || [];
  const lastItem = items[items.length - 1];
  return {
    count: items.length,
    loadMoreKey: items.length === DEFAULT_COUNT && lastItem?.id
      ? JSON.stringify({ lastId: lastItem.id })
      : null,
    items: items.map(p => formatPost(p, 500)),
  };
};

const formatPost = (item, contentLimit = 0) => {
  const rawContent = item?.content || item?.text || '';
  const content = contentLimit > 0 && rawContent.length > contentLimit
    ? rawContent.slice(0, contentLimit) + '...[截断]'
    : rawContent;
  return {
    id: item?.id || item?.['_id'] || '',
    content,
    username: item?.user?.username || '',
    nickname: item?.user?.nickname || item?.user?.screenName || '',
    createdAt: item?.createdAt || item?.created_at || '',
    likeCount: item?.likedCount || item?.likeCount || 0,
    commentCount: item?.commentCount || 0,
    topicId: item?.topic?.id || '',
    topicName: item?.topic?.content || '',
    topics: item?.topic ? [item.topic.content] : [],
  };
};

const formatComments = (data) => {
  const comments = data?.data || [];
  return {
    count: comments.length,
    comments: comments.map(c => ({
      id: c?.id || c?.['_id'] || '',
      content: c?.content || c?.text || '',
      username: c?.user?.username || '',
      nickname: c?.user?.nickname || c?.user?.screenName || '',
      createdAt: c?.createdAt || c?.created_at || '',
      likeCount: c?.likedCount || c?.likeCount || 0,
    })),
  };
};

const formatSearchResults = (data, keyword, options = {}) => {
  const { compact = false, contentLimit = 300, maxResults = 15 } = options;
  const items = data?.data || [];
  const results = [];

  for (const item of items) {
    if (results.length >= maxResults) break; // Enforce max results

    const t = item?.type || '';
    if (t === 'SECTION_HEADER' || t === 'SECTION_FOOTER') continue;

    if (t === 'USER_SECTION') {
      for (const u of item.items || []) {
        if (results.length >= maxResults) break;
        results.push({
          type: 'user',
          id: u.id || u.username || '',
          content: (u.briefIntro || '').slice(0, contentLimit),
          username: u.username || '',
          nickname: u.screenName || '',
        });
      }
      continue;
    }

    if (!item?.content && t !== 'TOPIC') continue;

    let formattedItem;
    if (t === 'TOPIC') {
      formattedItem = {
        type: 'topic',
        id: item.id || '',
        content: (item.content || '').slice(0, contentLimit),
        topicId: item.id || '',
        topicName: item.content || '',
      };
      if (!compact) {
        formattedItem.likeCount = item.subscribersCount || 0;
      }
    } else {
      const originalContent = item.content || '';
      formattedItem = {
        type: 'post',
        id: item.id || '',
        content: originalContent.length > contentLimit ? originalContent.slice(0, contentLimit) + '...[截断]' : originalContent,
        nickname: item.user?.nickname || item.user?.screenName || '',
        topicName: item.topic?.content || '',
      };
      if (!compact) {
        formattedItem.username = item.user?.username || '';
        formattedItem.likeCount = item.likedCount || 0;
        formattedItem.commentCount = item.commentCount || 0;
        formattedItem.topicId = item.topic?.id || '';
      }
    }
    results.push(formattedItem);
  }
  return { keyword, count: results.length, results };
};

const resolveUsername = (raw) => {
  if (!raw) return '';
  // UUID 格式
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) return raw;
  // 主页 URL
  const match = raw.match(/https?:\/\/(web\.)?okjike\.com\/u\/([0-9a-f-]+)/i);
  if (match) return match[2];
  // 短码
  if (/^[A-Za-z0-9]{4,10}$/.test(raw) && /[A-Z]/.test(raw) && /[a-z]/.test(raw)) {
    return raw; // 让 API 处理
  }
  return raw;
};

// 昵称 -> UUID 缓存（插件生命周期内有效）
const nicknameCache = new Map();

// 异步版本：支持通过昵称自动搜索获取用户ID
// 复用 actionSearch 的格式化结果，确保字段映射一致
const resolveUsernameAsync = async (raw) => {
  if (!raw) return '';
  // UUID 格式直接返回
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) return raw;
  // 主页 URL
  const match = raw.match(/https?:\/\/(web\.)?okjike\.com\/u\/([0-9a-f-]+)/i);
  if (match) return match[2];
  // 短码格式让API处理
  if (/^[A-Za-z0-9]{4,10}$/.test(raw) && /[A-Z]/.test(raw) && /[a-z]/.test(raw)) {
    return raw;
  }
  // 其他情况视为昵称，先查缓存
  if (nicknameCache.has(raw)) {
    log(`缓存命中: ${raw} -> ${nicknameCache.get(raw)}`);
    return nicknameCache.get(raw);
  }
  // 缓存未命中，通过搜索获取用户UUID
  log(`通过昵称搜索用户: ${raw}`);
  try {
    const searchResult = await actionSearch({ keyword: raw, count: '10' });
    const results = searchResult?.results || [];
    // 优先精确匹配昵称
    for (const r of results) {
      if (r.type === 'user' && r.nickname === raw) {
        log(`精确匹配: ${raw} -> ${r.username} (${r.nickname})`);
        nicknameCache.set(raw, r.username);
        return r.username;
      }
    }
    // 无精确匹配则取第一个用户结果
    for (const r of results) {
      if (r.type === 'user') {
        log(`模糊匹配: ${raw} -> ${r.username} (${r.nickname})`);
        nicknameCache.set(raw, r.username);
        return r.username;
      }
    }
    log(`搜索结果中未找到用户: ${raw}`);
  } catch (e) {
    log(`搜索用户失败: ${e.message}，原样传递`);
  }
  return raw;
};

// --- 6. 主入口 ---
const ACTION_MAP = {
  check_login_status: actionCheckLoginStatus,
  search: actionSearch,
  get_user_posts: actionGetUserPosts,
  get_following_feeds: actionGetFollowingFeeds,
  get_recommend_feeds: actionGetRecommendFeeds,
  get_topic_feed: actionGetTopicFeed,
  get_post_detail: actionGetPostDetail,
  get_comments: actionGetComments,
  get_post_with_comments: actionGetPostWithComments,
  get_user_profile: actionGetUserProfile,
  create_post: actionCreatePost,
  add_comment: actionAddComment,
  like_post: actionLikePost,
  unlike_post: actionUnlikePost,
  follow_user: actionFollowUser,
  unfollow_user: actionUnfollowUser,
  get_my_topics: actionGetMyTopics,
  read_my_topics: actionReadMyTopics,
};

let inputData = '';
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', async () => {
  try {
    if (!inputData || !inputData.trim()) {
      sendError('未从 stdin 接收到任何数据');
    }
    const request = JSON.parse(inputData.trim());
    const { action, ...args } = request;
    if (!action) sendError('缺少 action 参数');

    const handler = ACTION_MAP[action];
    if (!handler) {
      sendError(`未知 action: ${action}，支持的: ${Object.keys(ACTION_MAP).join(', ')}`);
    }

    log(`action: ${action}`);
    const result = await handler(args);
    sendResponse({ status: 'success', result });
  } catch (e) {
    log('异常:', e.message);
    sendError(e.message);
  }
});
