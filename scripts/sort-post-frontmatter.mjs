import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsRoot = path.join(root, "docs", "posts");
const courseRoot = path.join(docsRoot, "本科课程笔记");
const basicAlgorithmRoot = path.join(docsRoot, "算法", "基础算法");

const courseDirs = [
  ["计算机组成", "计算机组成", 10, "计算机组成原理、指令系统、实验与作业笔记。"],
  ["操作系统", "操作系统", 20, "操作系统课程复习、作业、实验与概念梳理。"],
  ["数据结构", "数据结构", 30, "数据结构课程作业与基础知识整理。"],
  ["计算机网络", "计算机网络", 40, "计算机网络课程章节笔记与作业记录。"],
  ["数据库", "数据库", 50, "数据库课程实验与数据库工具使用记录。"],
  ["编译原理", "编译原理", 60, "编译原理作业、随堂测与词法/语法分析实验。"],
  ["离散数学", "离散数学", 70, "离散数学各主题复习笔记。"],
  ["数字电路", "数字电路", 80, "数字电路作业与实验记录。"],
  ["概率论", "概率论", 90, "概率论个人向复习资料。"],
  ["数学建模", "数学建模", 100, "数学建模作业与大作业记录。"],
  ["图形学", "图形学", 110, "计算机图形学复习笔记。"],
  ["软件工程", "软件工程", 120, "软件工程相关课程、项目管理、系统分析与质量保证笔记。"],
  ["面向对象程序设计", "面向对象程序设计", 130, "面向对象程序设计作业与课程大作业记录。"],
  ["Python与数据分析", "Python 与数据分析", 140, "Python 综合训练、Flask 与数据分析练习记录。"],
  ["自然语言处理", "自然语言处理", 150, "自然语言处理课程实验与主题笔记。"],
  ["Linux实验", "Linux 实验", 160, "Linux 环境配置、进程/文件/网络服务实验记录。"],
  ["学习工具与环境", "学习工具与环境", 170, "课程学习中常用工具、环境配置与资料整理。"],
  ["课程杂记", "课程杂记", 180, "本科课程相关的学期总结、竞赛与零散记录。"],
];

const articleOrders = {
  计算机组成: [
    "XJTUSE-OA-ch01-09.md",
    "XJTUSE-OA-ch10-18.md",
    "XJTUSE-OA-homework.md",
    "XJTUSE-计组实验.md",
    "XJTUSE-计组大实验.md",
  ],
  操作系统: [
    "XJTUSE-OS-MOOC.md",
    "XJTUSE-OS-ch1-8.md",
    "XJTUSE-OS-ch9-13.md",
    "XJTUSE-OS-homework.md",
    "XJTUSE-OS-名词概念梳理.md",
    "【XJTU-OS】锁 _ java实现.md",
    "XJTUSE-OS-考后.md",
  ],
  数据结构: [
    "XJTUSE-数据结构-homework1.md",
    "XJTUSE-数据结构-homework2.md",
  ],
  计算机网络: [
    "XJTUSE-计网-第1章-计网概论.md",
    "XJTUSE-计网-第1章-homework.md",
    "XJTUSE-计网-第2章-homework.md",
    "XJTUSE-计网-第3章-homework.md",
    "XJTUSE-计网-第4次-homework.md",
  ],
  数据库: [
    "MySQL 数据库实验.md",
    "SQL Server安装及使用.md",
  ],
  编译原理: [
    "XJTUSE-编译原理-第三章-homework.md",
    "XJTUSE-编译原理-第四章-homework.md",
    "XJTUSE-编译原理-第五章-HOMEWORK.md",
    "XJTUSE-编译原理-第七章-HOMEWORK.md",
    "XJTUSE-编译原理-随堂测.md",
    "XJTUSE-编译原理实验-词法分析.md",
    "XJTUSE-编译原理实验-语法分析.md",
  ],
  离散数学: [
    "XJTUSE-离散数学-集合.md",
    "XJTUSE-离散数学-关系.md",
    "XJTUSE-离散数学-命题演算.md",
    "XJTUSE-离散数学-谓词演算.md",
    "XJTUSE-离散数学-代数系统.md",
    "XJTUSE-离散数学-图论.md",
  ],
  数字电路: [
    "XJTUSE-数电-第1次&第2次&第3次作业.md",
    "XJTUSE-数电-第四次作业.md",
    "XJTUSE-数电-第五次作业.md",
    "XJTUSE - 数电实验.md",
  ],
  概率论: [
    "概率论-个人向使用.md",
  ],
  数学建模: [
    "XJTUSE-数学建模-homework1.md",
    "XJTUSE-数学建模-homework2.md",
    "XJTUSE-数学建模-homework3.md",
    "XJTUSE-数学建模-大作业.md",
  ],
  图形学: [
    "XJTUSE-图形学.md",
  ],
  软件工程: [
    "项目管理.md",
    "XJTUSE-项目管理.md",
    "XJTUSE-系统设计与分析.md",
    "XJTUSE-系统设计与分析23年考试题....md",
    "XJTUSE-软件体系结构基础.md",
    "XJTUSE-软件质量保证.md",
    "XJTUSE-软件质量保证实操.md",
    "XJTUSE-软件质量保证大作业.md",
  ],
  面向对象程序设计: [
    "XJTUSE-面向对象-homework1.md",
    "XJTUSE-面向对象-homework2.md",
    "XJTUSE-扫雷大作业.md",
  ],
  Python与数据分析: [
    "XJTUSE-python综合训练实验.md",
    "Flask-个人学习.md",
    "FLASK-转化为exe.md",
    "Kaggle-PlayGround-Poisonous-Mushrooms.md",
    "Kaggle-PlayGround-Regression-of-Used-Car-Prices.md",
  ],
  自然语言处理: [
    "XJTUSE-NLP-词法分析.md",
    "XJTUSE-NLP-语法分析.md",
    "XJTUSE-NLP-文本分类.md",
  ],
  Linux实验: [
    "VMware配置Linux虚拟机配置过程及遇见的问题.md",
    "XJTUSE - 21 级 Linux 综合实验.md",
    "XJTUSE-Linux实验-进程管理实验.md",
    "XJTUSE-Linux实验-文件管理实验.md",
    "XJTUSE-Linux实验-NFS、Samba、Apache实验.md",
  ],
  学习工具与环境: [
    "个人实用工具库.md",
    "Git使用手册与学习资料.md",
    "Latex手册自用.md",
    "IDEA-类图插件.md",
    "IntelliJ IDEA 的 Junit 配置.md",
    "穿透机与跳板机配置.md",
  ],
  课程杂记: [
    "XJTUSE-大三上.md",
    "XJTUSE-大三下.md",
    "XJTU-数学竞赛.md",
    "XJTUSE-web测试大赛.md",
    "XJTU-雨课堂-形式与政策-防暂停指南.md",
  ],
};

const basicAlgorithmOrder = [
  "算法学习记录导航-持续更新.md",
  "XJTUSE-算法-串讲知识点梳理.md",
  "二分法-日常练习记录.md",
  "前缀和-日常学习.md",
  "差分-算法日常练习记录.md",
  "双指针-日常练习记录.md",
  "递归-算法日常练习记录.md",
  "回溯-算法日常练习.md",
  "BFS-算法练习日常练习.md",
  "DFS-算法日常练习记录.md",
  "Flood-Fill-算法日常练习记录.md",
  "哈希-算法日常练习记录.md",
  "归并排序-日常练习记录.md",
  "快速幂-算法日常练习记录.md",
  "单调队列-算法日常练习记录.md",
  "并查集-算法日常练习记录.md",
  "树状数组-算法日常练习记录.md",
  "二维树状数组-算法学习日常记录.md",
  "区间合并-算法日常练习记录.md",
  "多路归并-算法日常练习记录.md",
  "线性DP-算法日常练习记录.md",
  "区间DP-算法日常练习记录.md",
  "状压DP-算法日常练习记录.md",
  "背包问题-算法日常练习记录.md",
  "贡献法-算法日常练习记录.md",
  "只通过+1和x2把0变成20240701.md",
];

const indexNotes = {
  数据结构: `::: tip 常见数据结构

- 一、线性表

顺序线性表、链式线性表

- 二、队列

- 三、堆

大顶堆、小顶堆

- 四、栈

- 五、树

    - 二叉树、满二叉树、完全二叉树、二叉查找树、平衡二叉树、红黑树

    - 哈夫曼树、哈夫曼编码
    - B-树、B+树

- 六、散列表（哈希表）

- 七、跳跃表

- 八、图

    - 无向图、有向图、简单图、完全图、有向完全图
    - 深度优先搜索（Depth First Search，DFS）、广度优先搜索（Breadth First Search，BFS）

:::
`,
};

function splitFrontmatter(content) {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const closeEnd = content.indexOf("\n", end + 1);
  return {
    fm: content.slice(4, end + 1),
    body: content.slice(closeEnd === -1 ? content.length : closeEnd + 1),
  };
}

function joinFrontmatter(fm, body) {
  return `---\n${fm.replace(/\n?$/, "\n")}---\n${body.replace(/^\n?/, "\n")}`;
}

function setScalarField(fm, key, value) {
  if (new RegExp(`^${key}:`, "m").test(fm)) {
    const lines = fm.split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].startsWith(`${key}:`)) {
        out.push(`${key}: ${value}`);
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) i += 1;
      } else {
        out.push(lines[i]);
      }
    }
    return out.join("\n");
  }
  return `${fm.replace(/\n?$/, "\n")}${key}: ${value}\n`;
}

function setListField(fm, key, values) {
  const replacement = `${key}:\n${values.map((value) => `- ${value}`).join("\n")}`;
  if (!new RegExp(`^${key}:`, "m").test(fm)) {
    return `${fm.replace(/\n?$/, "\n")}${replacement}\n`;
  }

  const lines = fm.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith(`${key}:`)) {
      out.push(replacement);
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) i += 1;
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n");
}

function updateMarkdown(filePath, updater) {
  const oldContent = fs.readFileSync(filePath, "utf8");
  const parsed = splitFrontmatter(oldContent);
  let newContent;

  if (!parsed) {
    newContent = updater("", oldContent, false);
  } else {
    newContent = joinFrontmatter(updater(parsed.fm, parsed.body, true), parsed.body);
  }

  if (newContent !== oldContent) fs.writeFileSync(filePath, newContent);
}

function setFrontmatter(filePath, { order, tag, category }) {
  updateMarkdown(filePath, (fm, body, hasFm) => {
    if (!hasFm) {
      let next = `title: "${path.basename(filePath, ".md")}"\n`;
      if (tag) next = setListField(next, "tags", [tag]);
      if (category) next = setScalarField(next, "category", category);
      if (order !== undefined) next = setScalarField(next, "order", order);
      return joinFrontmatter(next, body);
    }

    let next = fm;
    if (tag) next = setListField(next, "tags", [tag]);
    if (category) next = setScalarField(next, "category", category);
    if (order !== undefined) next = setScalarField(next, "order", order);
    return next;
  });
}

function getTitle(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return match ? match[1] : path.basename(filePath, ".md");
}

function getOrder(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/^order:\s*(\d+)/m);
  return match ? Number(match[1]) : Infinity;
}

function getArticleFiles(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".md") && name !== "index.md")
    .sort((a, b) => {
      const orderDiff = getOrder(path.join(dirPath, a)) - getOrder(path.join(dirPath, b));
      return orderDiff || a.localeCompare(b, "zh-CN");
    });
}

function linkFor(fileName) {
  return `./${encodeURI(fileName.replace(/\.md$/, ""))}`;
}

function articleList(dirPath) {
  return getArticleFiles(dirPath)
    .map((name) => `- [${getTitle(path.join(dirPath, name))}](${linkFor(name)})`)
    .join("\n");
}

function writeIndex(dirPath, title, order, description, extra = "") {
  const list = articleList(dirPath);
  fs.writeFileSync(
    path.join(dirPath, "index.md"),
    `---\ntitle: ${title}\norder: ${order}\n---\n\n# ${title}\n\n${description}\n${extra ? `\n${extra}` : ""}${list ? `\n## 文章\n\n${list}\n` : ""}`,
  );
}

function orderedFiles(dirPath, preferred) {
  const files = fs.readdirSync(dirPath).filter((name) => name.endsWith(".md") && name !== "index.md");
  return [
    ...preferred.filter((name) => files.includes(name)),
    ...files.filter((name) => !preferred.includes(name)).sort((a, b) => a.localeCompare(b, "zh-CN")),
  ];
}

for (const [dir, title, order, description] of courseDirs) {
  const dirPath = path.join(courseRoot, dir);
  if (!fs.existsSync(dirPath)) continue;

  orderedFiles(dirPath, articleOrders[dir] || []).forEach((name, index) => {
    setFrontmatter(path.join(dirPath, name), {
      order: index + 1,
      tag: title,
      category: "本科课程笔记",
    });
  });

  writeIndex(dirPath, title, order, description, indexNotes[dir]);
}

fs.writeFileSync(
  path.join(courseRoot, "index.md"),
  `---\ntitle: 本科课程笔记\norder: 30\n---\n\n# 本科课程笔记\n\n本科阶段课程笔记与复习资料，按课程和学习场景重新归类。\n\n${courseDirs
    .map(([dir, title, , description]) => `- [${title}](./${encodeURI(dir)}/) - ${description}`)
    .join("\n")}\n`,
);

if (fs.existsSync(basicAlgorithmRoot)) {
  orderedFiles(basicAlgorithmRoot, basicAlgorithmOrder).forEach((name, index) => {
    setFrontmatter(path.join(basicAlgorithmRoot, name), {
      order: index + 1,
      tag: "算法",
      category: "算法",
    });
  });

  writeIndex(basicAlgorithmRoot, "基础算法", 10, "常用算法模板、专题练习与课程串讲。");
}

fs.writeFileSync(
  path.join(docsRoot, "算法", "index.md"),
  `---\ntitle: 算法\norder: 50\n---\n\n# 算法\n\n算法学习与刷题记录。\n\n- [基础算法](./${encodeURI("基础算法")}/) - 常用算法模板、专题练习与课程串讲。\n- [蓝桥杯](./${encodeURI("蓝桥杯")}/) - 蓝桥杯刷题与备赛记录。\n`,
);

setFrontmatter(path.join(docsRoot, "算法", "蓝桥杯", "index.md"), { order: 20 });
