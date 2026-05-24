#!/usr/bin/env node
/**
 * 展示已保存的圈子关键信息
 * 数据来源: /u01/VCPToolBox/Plugin/JikeScraper/data/jike-my-topics.json
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'jike-my-topics.json');

if (!fs.existsSync(DATA_FILE)) {
  console.log('❌ 数据文件不存在，请先运行 TopicsPlugin 获取数据');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
const topics = data.topics || [];

console.log(`\n📋 我的圈子（共 ${topics.length} 个）\n`);
console.log('─'.repeat(80));

topics.forEach((t, i) => {
  const name = t.name || '未知';
  const id = t.topicId || '-';
  const intro = t.briefIntro || t.intro || '-';
  const count = t.subscribersCount ? `${(t.subscribersCount / 10000).toFixed(1)}万` : '-';
  const type = t.topicType === 'OFFICIAL' ? '🏛️' : '👤';
  
  console.log(`\n${i + 1}. ${type} ${name}`);
  console.log(`   ID: ${id}`);
  console.log(`   介绍: ${intro.slice(0, 100)}${intro.length > 100 ? '...' : ''}`);
  console.log(`   人数: ${count}`);
  console.log('─'.repeat(80));
});

console.log(`\n✅ 数据时间: ${data.fetchedAt}\n`);
