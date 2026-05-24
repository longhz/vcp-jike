# JikeTopics 子插件

独立获取用户圈子列表的插件，不影响主 JikePlugin。

## 目录结构
```
topics/
├── TopicsPlugin.js       # 主插件脚本
└── plugin-manifest.json # 插件描述

data/                     # 数据输出目录（自动创建）
├── jike-my-topics.json        # 完整数据
└── jike-my-topics-summary.json # 摘要数据
```

## Actions
| action | 说明 |
|--------|------|
| `get_my_topics` | 获取全部圈子（自动翻页，最多120页），结果存入 data/ |
| `read_saved_data` | 读取已保存数据，参数 `type`: `full` 或 `summary` |
| `check_login_status` | 检查登录状态 |

## 数据格式
与 `~/.hermes/jike/data/` 保持一致。
