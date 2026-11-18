# QuizCompanion（刷题宝典）

手机端优先的刷题 Web 应用：章节刷题 / 模拟考试 / 错题本 / 收藏 / 班级教学 / 管理后台。

技术栈：Node.js + Express + MongoDB（后端） / React + Vite + Tailwind CSS + Framer Motion（前端）。

> 说明：解析功能已整体下线——答题、交卷、错题本、收藏、导出均不再展示解析；
> 后端不再下发 `analysis` / `showAnalysis` / `hideAnalysis` 字段（DB 旧字段保留但无人读取）。
> 三端入口分离：学员端 `/`、教师端 `/teacher`、管理后台 `/admin`，各用独立布局与导航。

## 目录结构

```text
QuizCompanion/
  package.json            # 根脚本（install:all / dev / seed）
  server/                 # 后端
    .env.example          # 环境变量模板（复制为 .env 后改）
    package.json
    src/
      index.js            # 入口，挂载全部路由
      db.js               # MongoDB 连接
      auth.js             # JWT + 角色守卫 + 会员判定
      utils.js            # 判分/抽样/验证码等
      models/             # User / Chapter / Question / Practice / Class / Exam
      routes/             # auth / chapters / questions / practice / exams / classes / admin
      seed.js             # 种子数据（npm run seed）
      selftest.mjs        # 后端接口自检（21 项）
      selftest2.mjs       # 解析下线专项验证（6 项）
  client/                 # 前端
    vite.config.js        # /api 代理到 http://localhost:4001
    src/
      api.js auth.jsx Toast.jsx
      layouts/            # StudentShell（学员底部四 Tab）/ TeacherShell（教师顶栏+三 Tab）
                          # AdminShell（后台顶栏+总览/题库/用户/班级/试卷）
      components/         # QuestionCard / ui / guards / Confirm
      pages/              # 学员：Login Register Home PracticeHome Practice Exams CustomExam
                          #      ExamDetail ExamResult Bank Mine Share
                          # 教师：Teacher.jsx（首页/出卷/班级详情/成绩）+ teacher/TeacherMine.jsx
                          # 管理：Admin.jsx（总览/题库/用户/班级/试卷）
```

## 数据库模型（MongoDB / Mongoose）

| 集合 | 说明 |
|---|---|
| User | 邮箱+密码哈希；`role`（student/teacher/admin）；`isMember/memberExpireAt`（会员）；`classId`（所属班级）；邮箱换绑验证码 |
| Chapter | 章节（name/sort/enabled） |
| Question | `chapterId`；`type`（single/multiple/judge/fill/short）；`stem/options/answer/textAnswer/score/enabled`（analysis 字段保留但不使用） |
| PracticeRecord | 每次答题一条（userId/questionId/chapterId/mode/result/userAnswer） |
| WrongBook | 错题本（userId+questionId 唯一，count/lastAnswer/mastered） |
| Favorite | 收藏（userId+questionId 唯一） |
| Class | 班级（name/code 6位码/teacherId/desc） |
| Exam | 试卷（kind=system/teacher/custom；scope=exam/homework；抽题规则+题快照 items；shareToken 分享码；时长/截止） |
| ExamAttempt | 作答（answers 明细/score/accuracy/status=doing/submitted） |

## 角色权限与三端入口

| 能力 | 免费学员(`/`) | 会员学员(`/`) | 教师(`/teacher`) | 超管(`/admin`) |
|---|---|---|---|---|
| 顺序/随机/章节刷题 | ✅ | ✅ | — | — |
| 错题本、收藏（仅正确答案） | ✅ | ✅ | — | — |
| 系统固定卷、教师布置考试 | ✅ | ✅ | —（教师负责出卷） | — |
| 自建自定义卷（选章节+题量） | ❌ 403 | ✅ | — | — |
| 导出错题 CSV（无解析列） | ❌ 403 | ✅ | — | — |
| 班级管理/出卷/学员数据 | ❌ | ❌ | ✅（仅自己班级） | ✅（查看） |
| 题库导入/用户会员/统计 | ❌ | ❌ | ❌ | ✅ |

- 登录后按角色自动分流：学员 → `/`、教师 → `/teacher`、管理员 → `/admin`（见 `Login.jsx`）
- 串端访问会被守卫拦回各自首页（见 `components/guards.jsx` 的 `RequireRole`）

## 快速开始（本地）

前置：Node.js 18+、MongoDB（本地默认 `mongodb://127.0.0.1:27017/wuli-baodian`）。

```bash
cd QuizCompanion
npm run install:all          # 安装前后端依赖
cp server/.env.example server/.env   # 按需修改
npm run seed                 # 初始化：8 章节 + 120 道示例题 + 2 套系统卷 + 4 个演示账号
npm run dev                  # 启动后端 http://localhost:4001（另开终端）
npm run dev:client           # 启动前端 http://localhost:5173（另开终端）
```

演示账号（密码均为 `123456`，可在 `server/.env` 用 `SEED_PASSWORD` 改）：

| 账号 | 角色 | 入口 |
|---|---|---|
| admin@wlbd.cn | 超级管理员 | `/admin` |
| teacher@wlbd.cn | 教师（班主任） | `/teacher` |
| student@wlbd.cn | 免费学员 | `/` |
| member@wlbd.cn | 会员学员（1 年有效期） | `/` |

## 题库导入（Excel/CSV）

管理后台 → 题库 → 「Excel/CSV 导入」。列：`章节 / 题型 / 题干 / 选项A~F / 答案 / 分值`（无解析列）。

- 题型写：单选 / 多选 / 判断 / 填空 / 简答
- 答案：单选填 `A`；多选填 `AB`（或 `A,B`）；判断填 `对/错`；填空/简答直接写文本（多空用 `|` 分隔）
- 章节不存在会自动创建。约 1200 题建议分批导入（单文件 ≤10MB）。

## 教师使用流程

1. 打开 `/teacher` → 班级 Tab → 创建班级 → 得到 6 位班级码，发给学员
2. 学员在学员端「我的 → 加入班级」输入班级码
3. 布置 Tab：选班级 → 随机抽取或按章节抽取 → 设时长/截止 → 发布（作业/考试二选一）
4. 分享：考试卡片「分享」→ 二维码/链接发群里，学员登录后即可参加
5. 班级页查看：概览（参与率/平均分/正确率）→ 学员数据（排序）→ 考试管理（结束/删除/看成绩）

## 接口自检

```bash
cd server && node selftest.mjs    # 21 项全 PASS 为正常（核心功能回归）
cd server && node selftest2.mjs   # 6 项全 PASS（解析下线专项：无 analysis 下发）
```

## 注意事项

- 后端端口 4001（如被占用请改 `server/.env` 的 PORT；前端代理 `client/vite.config.js` 同步改）
- 邮箱换绑采用「密码确认 + 6 位验证码」两步流程；未接 SMTP，验证码演示模式由接口直接返回（见个人中心 → 更换邮箱）
- 考试交卷只自动判客观题；填空/简答记 0 分并展示参考答案

## 公开版配置

原题库、生产迁移工具和安装演示媒体不随公开版分发；请在管理后台导入自有题库。演示账号仅用于本机开发。

请在 `server/.env` 中配置你自己的 MongoDB、SMTP 和独立随机密钥。JWT 密钥至少 32 字符，例如运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`。Android 发布版需自行配置签名。

源码按 MIT 许可证授权，见 `LICENSE`。
