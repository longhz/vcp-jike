# JikeScraper - 即刻内容获取插件

**版本**: 1.0.0  
**插件类型**: synchronous (同步工具)  
**通信协议**: stdio  
**运行时**: Node.js

---

## 功能概览

| 功能 | 工具命令 | 说明 |
|------|----------|------|
| 登录 | `JikeLogin` | 扫码登录即刻账号 |
| 状态 | `JikeLoginStatus` | 检查当前登录状态 |
| 搜索 | `JikeSearch` | 搜索帖子/用户/圈子 |
| 推荐 | `JikeRecommendFeeds` | 获取发现页推荐动态 |
| 关注 | `JikeFollowFeeds` | 获取关注的人的最新动态 |
| 圈子 | `JikeTopicFeed` | 获取指定圈子的动态 |
| 帖子详情 | `JikePostDetail` | 获取单条帖子完整信息 |
| 评论 | `JikeComments` | 获取帖子的评论列表 |
| 用户资料 | `JikeUserProfile` | 获取用户个人资料 |
| 用户帖子 | `JikeUserPosts` | 获取用户发布的所有帖子 |
| 发帖 | `JikeCreatePost` | 发布新动态 |
| 评论 | `JikeAddComment` | 给帖子发表评论 |
| 点赞 | `JikeLike` | 给帖子点赞 |
| 关注 | `JikeFollow` | 关注用户 |
| 取消点赞 | `JikeUnlike` | 取消点赞 |
| 取消关注 | `JikeUnfollow` | 取消关注 |
| **我的圈子** | `JikeMyTopics` | 获取用户已加入的全部圈子 |
| **读取圈子** | `JikeReadMyTopics` | 读取已保存的圈子数据 |

---

## 安装步骤

### 1. 扫码登录（首次必须）

```bash
cd /u01/VCPToolBox/Plugin/JikeScraper
node jike-setup.js
```

运行后会输出一个扫码链接或使用图片扫码：

```
  请用即刻 App 扫码，或点击链接确认：

  https://www.okjike.com/account/scan?uuid=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  在即刻 App 中搜索"扫一扫"，扫描上方二维码

  二维码 UUID: 6ca6e299-83d7-4d94-837c-79f530f03551
========================================


  二维码图片已生成: /u01/VCPToolBox/Plugin/JikeScraper/qrcode.png
  终端显示有限，请用上方链接或直接扫描该图片
```

**扫码方式**（二选一）：
- 在浏览器打开链接，即刻 App 扫码确认
- 在即刻 App 里搜索"扫一扫"，扫描该二维码

登录成功后会显示：
```
========================================
  登录成功！
========================================
  Token 文件: /u01/VCPToolBox/Plugin/JikeScraper/tokens.json
  用户: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
========================================
```

> **注意**：二维码有效期约 180 秒，超时需重新运行 `jike-setup.js`

### 2. 重启 vcp-main 使插件生效

```bash
pm2 restart vcp-main
```

### 3. 验证插件加载

```bash
pm2 logs vcp-main --lines 30 | grep -i jike
```

---

## 使用方式

### VCP 协议调用格式

插件通过 VCP 的 `<<<[TOOL_REQUEST]>>>` 协议调用，以下是各工具的标准调用格式：

#### 登录状态检查

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」check_login_status「末」
<<<[END_TOOL_REQUEST]>>>
```

返回：
```json
{
  "status": "success",
  "result": {
    "loggedIn": true,
    "username": "72ca4b34-xxxx-xxxx-xxxx-661e8eb2b3d4",
    "nickname": "用户昵称",
    "followersCount": 100,
    "followingCount": 50
  }
}
```

---

### 搜索

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」search「末」,
keyword:「始」AI 最新进展「末」
<<<[END_TOOL_REQUEST]>>>
```

返回结果包含帖子、用户、圈子，按相关性排序。每条结果包含：
- `id`: 帖子/圈子 ID
- `content`: 内容摘要
- `username` / `nickname`: 发布者信息
- `likeCount` / `commentCount`: 互动数据
- `topicId` / `topicName`: 所属圈子（帖子有）

---

### 推荐动态

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_recommend_feeds「末」
<<<[END_TOOL_REQUEST]>>>
```

返回：
```json
{
  "status": "success",
  "result": {
    "count": 25,
    "loadMoreKey": "{\"lastId\":\"69dc6688800201ac68d39cd9\"}",
    "items": [
      {
        "id": "69dc6688800201ac68d39cd9",
        "content": "帖子内容...",
        "username": "72ca4b34-xxxx",
        "nickname": "用户昵称",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "likeCount": 42,
        "commentCount": 5,
        "topics": ["圈子名"]
      }
    ]
  }
}
```

**翻页**：将返回的 `loadMoreKey` 作为 `load_more_key` 参数再次调用。

---

### 关注动态

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_following_feeds「末」
<<<[END_TOOL_REQUEST]>>>
```

---

### 圈子动态

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_topic_feed「末」,
topic_id:「始」59bdc5d8e569780011a4d791「末」
<<<[END_TOOL_REQUEST]>>>
```

> `topic_id` 可从搜索结果中获取（搜索返回的数据中 `topicId` 字段即为圈子 ID）

---

### 帖子详情

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_post_detail「末」,
post_id:「始」69dfaaae50ac251af897b372「末」
<<<[END_TOOL_REQUEST]>>>
```

返回：帖子完整内容、发布者信息、发布时间、图片列表、转发数等。

---

### 评论列表

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_comments「末」,
post_id:「始」69dfaaae50ac251af897b372「末」
<<<[END_TOOL_REQUEST]>>>
```

支持翻页，用法同动态列表。

---

### 用户资料

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_user_profile「末」,
username:「始」72ca4b34-7890-4ca3-bd3b-661e8eb2b3d4「末」
<<<[END_TOOL_REQUEST]>>>
```

`username` 支持以下格式：
- UUID：`72ca4b34-7890-4ca3-bd3b-661e8eb2b3d4`
- 主页 URL：`https://web.okjike.com/u/72ca4b34-...`
- 短码：`okjk.co/xxxxx`

返回：昵称、简介、粉丝数、关注数、帖子数、获赞数、头像 URL、是否已关注。

---

### 用户帖子

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_user_posts「末」,
username:「始」72ca4b34-7890-4ca3-bd3b-661e8eb2b3d4「末」
<<<[END_TOOL_REQUEST]>>>
```

---

### 发帖

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」create_post「末」,
content:「始」这是我的第一条动态「末」
<<<[END_TOOL_REQUEST]>>>
```

**发到指定圈子**（可选）：
```
action:「始」create_post「末」,
content:「始」这是我的动态「末」,
topic_id:「始」59bdc5d8e569780011a4d791「末」
<<<[END_TOOL_REQUEST]>>>
```

---

### 评论

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」add_comment「末」,
post_id:「始」69dfaaae50ac251af897b372「末」,
content:「始」写得真好！「末」
<<<[END_TOOL_REQUEST]>>>
```

---

### 点赞

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」like_post「末」,
post_id:「始」69dfaaae50ac251af897b372「末」
<<<[END_TOOL_REQUEST]>>>
```

**取消点赞**：`action` 改为 `unlike_post`，参数相同。

---

### 关注用户

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」follow_user「末」,
username:「始」72ca4b34-7890-4ca3-bd3b-661e8eb2b3d4「末」
<<<[END_TOOL_REQUEST]>>>
```

**取消关注**：`action` 改为 `unfollow_user`，参数相同。

---

### 我的圈子

获取用户已加入的全部圈子（自动翻页最多120页），结果持久化到 `data/` 目录：

```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」get_my_topics「末」
<<<[END_TOOL_REQUEST]>>>
```

返回：
```json
{
  "status": "success",
  "result": {
    "total": 169,
    "byType": { "official": 159, "user": 10 },
    "topInterests": ["网络小说迷", "出海人的日常", ...],
    "fetchedAt": "2026-04-25T10:31:52+08:00",
    "savedTo": {
      "full": "/u01/VCPToolBox/Plugin/JikeScraper/data/jike-my-topics.json",
      "summary": "/u01/VCPToolBox/Plugin/JikeScraper/data/jike-my-topics-summary.json"
    }
  }
}
```

**读取已保存数据：**
```
<<<[TOOL_REQUEST]>>>
tool_name:「始」JikeScraper「末」,
action:「始」read_my_topics「末」,
type:「始」summary「末」
<<<[END_TOOL_REQUEST]>>>
```

**CLI 展示脚本：**
```bash
node /u01/VCPToolBox/Plugin/JikeScraper/topics/show-topics.js
```

> 数据输出目录: `/u01/VCPToolBox/Plugin/JikeScraper/data/`

---

## 配置文件

插件配置文件路径：`/u01/VCPToolBox/Plugin/JikeScraper/config.env`

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `JikeTokensPath` | `tokens.json`（插件目录） | token 文件路径 |
| `JikeApiBase` | `https://api.ruguoapp.com` | API 地址，通常不改 |
| `JikeWebOrigin` | `https://web.okjike.com` | Web Origin，通常不改 |
| `JikeDefaultCount` | `25` | 默认返回条数上限 |
| `JikeProxyUrl` | 无 | HTTP 代理（如需海外访问） |

---

## 文件结构

```
JikeScraper/
├── plugin-manifest.json    # VCP 插件契约（声明 16 个工具）
├── JikePlugin.js           # 主程序（stdio 协议入口）
├── jike-setup.js           # 扫码登录工具
├── tokens.json             # 登录 token（登录后自动生成，不提交）
├── config.env.example      # 配置模板
├── topics/                 # 圈子展示脚本
│   └── show-topics.js      # CLI 查看圈子关键信息
├── data/                   # 数据输出目录（运行后自动创建）
│   ├── jike-my-topics.json
│   └── jike-my-topics-summary.json
└── README.md               # 本文档
```

---

## 常见问题

**Q: 提示"未登录或 tokens.json 不存在"**  
A: 先运行 `node jike-setup.js` 完成扫码登录。

**Q: Token 过期怎么办？**  
A: 删掉 `tokens.json`，重新运行 `node jike-setup.js` 扫码登录。

**Q: 扫码超时**  
A: 二维码有效期 180 秒，超时后重新运行 `jike-setup.js`。

**Q: 插件加载后报 404**  
A: 检查 API 端点是否有更新，可对比 `~/.hermes/skills/jike-scrape/src/mcp_server.py` 中的实现。

**Q: 评论/发帖提示权限不足**  
A: 部分操作需要会员权限，检查账号是否开通了相关功能。
