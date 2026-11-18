# QuizCompanion（刷题宝典）Android APK 打包指南

Android 工程位于 `client/android/`。React + Vite 先构建到 `client/dist/`，Capacitor 再同步网页和原生插件，最后由 Gradle 生成 APK。APK 不内置 Express、MongoDB 或原题库；后端需要单独部署，题库可在管理后台导入。

## 1. 准备环境

- Node.js 22 或更高版本（包含 npm）。
- Android Studio、JDK 21、Android SDK Platform 36、SDK Build-Tools 和 Platform-Tools。Gradle 所用的 JDK 设为 21；命令行可通过 `JAVA_HOME` 指向安装目录，再用 `java -version` 检查。
- 用 Android Studio 的 SDK Manager 安装 SDK。如果命令行找不到 SDK，可设置 `ANDROID_HOME`，或在本机 `client/android/local.properties` 中设置 `sdk.dir`。不要提交这个文件。
- 仓库自带 Gradle Wrapper，固定为 8.14.3，无需全局安装 Gradle。应用最低支持 Android 7.0（API 24）。

## 2. 配置 APK 使用的后端

先按[项目 README](../README.md#公开版配置)配置 `server/.env` 和 MongoDB，把服务部署到手机可访问、证书受信任的 HTTPS 地址。反向代理需要转发 `/api` 和 `/socket.io` 并支持 WebSocket 升级。

在 `client/.env.production.local` 填入自己的服务根地址，不要加 `/api`：

```dotenv
VITE_API_BASE=https://api.example.com
```

该变量在 Vite 构建时进入 APK，同时用于 HTTP API 和 Socket.IO。不要把密钥写入 `VITE_` 变量。不配置时，原生端会回退到原项目的服务地址，因此自行部署时不要跳过这一步。`localhost` 指向手机本身，不能用来连接电脑上的后端。如要分发自己的 APK，检查 `client/src/config.js` 中的更新下载站设置；它和 API 地址是分开配置的。

## 3. 构建调试 APK

从仓库根目录开始，在 Windows PowerShell 中运行：

```powershell
cd client
npm ci
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

macOS / Linux 的前五行相同，最后一行改成 `./gradlew assembleDebug`。

输出：`client/android/app/build/outputs/apk/debug/app-debug.apk`。打开手机的 USB 调试、连接并授权后，可从仓库根目录运行 `adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk`。也可以从 `client/` 运行 `npx cap open android`，在 Android Studio 选择设备后运行。安装后先验证登录、加载题库、提交答题结果和接收实时通知。

## 4. 构建正式签名 APK

先执行第 3 步中的网页构建和 Capacitor 同步，再从 `client/` 执行 `npx cap open android`。在 Android Studio 选择 **Build → Generate Signed App Bundle or APK → APK**，选择 `app` 模块和 `release` 构建类型，创建或选用你自己的密钥库。正式 APK 的签名密钥、别名密码和备份必须私下保存，不要提交到 Git。

本项目包名为 `top.wakaibg5.wlbd`。升级同一应用时，签名必须匹配，且应在 `client/android/app/build.gradle` 中递增 `versionCode` 并更新 `versionName`。同步更新 `client/src/config.js` 中的 `APP_VERSION` 及自己的后端版本发布记录。若要与其他签名的原版共存，使用不同的 `applicationId`，并与 `client/capacitor.config.json` 的 `appId` 保持一致。

## 常见问题

- 改了 `VITE_API_BASE` 但 APK 还连旧地址：重新运行 `npm run build` 和 `npx cap sync android`，再打包。
- 可以开 App，但登录失败或收不到实时通知：从手机检查 HTTPS 地址和证书，检查 WebView 来源是否被后端允许，以及代理是否转发 Socket.IO。
- 登录后题库为空：确认导入的是部署环境所用数据库；原题库不随开源版分发。
- 安装提示签名冲突：已有同包名但不同签名的安装。换不同包名，或先备份再卸载旧应用；卸载会删除本机私有数据，包括未同步的记录。
