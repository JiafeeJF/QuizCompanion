/**
 * 应用配置（构建期静态信息 + 前端可覆盖项）
 * APP_VERSION：当前端版本（发版时同步改；检查更新/版本号展示/下载文件名都读它）
 */
export const APP_VERSION = '1.7.1';

/**
 * 本地调试开关：关闭人机验证（ALTCHA）
 * - true：登录/注册跳过验证小组件，直接提交（本地联调省事）
 * - 注意：后端仍会校验 captchaToken，直连线上接口会报验证失败；
 *   本地后端同步放行后才真正生效（到时后端加一行即可，用到时再说）
 * - 上线/打包前必须改回 false
 */
export const DISABLE_CAPTCHA = false;

/**
 * 开发者页配置（兜底值，失败/离线时用）：
 * 优先读后端 /api/meta/developer（管理后台可编辑），失败/未配置时用这里的默认值。
 * 空字段在开发者页统一显示为「---」；链接留空时对应按钮直接隐藏。
 */
export const DEV_CONFIG = {
  /** 开发者展示头像（留空则显示首字圆形占位） */
  avatar: '',
  /** 开发者名称 */
  name: '物联宝典开发者',
  /** 开发者介绍文案 */
  intro: '本应用由开发者独立完成全部开发工作，包括产品设计、前端、后端、题库整理与功能实现。',
  /** 抖音主页链接 */
  tiktok: '',
  /** GitHub 主页链接 */
  github: '',
  /** 服务器所在地（对外展示文案） */
  serverLocation: '日本大阪',
};

/**
 * 版本下载配置
 * - host: 下载站域名（写死，浏览器/APP 统一走 HTTPS）
 * - latestFileName: 后台本地上传 APK 由 nginx 静态托管在 /downloads/ 下，
 *   与后端 /api/app/version 返回的最新版 downloadPath 文件一致；这里仅作为
 *   「检查更新」打开下载链接时的直链保底（路径 /downloads/{latestFileName}）。
 */
export const UPDATE_DOWNLOAD = {
  host: 'https://download.wakaibg5.top',
  latestFileName: 'wlbd-1.7.1.apk',
};

/** 独立下载站：网页引导与 APK 更新统一从这里进入。 */
export const DOWNLOAD_SITE_URL = UPDATE_DOWNLOAD.host;

/** 由 host + fileName 拼出直链（前端打开跳系统浏览器下载） */
export function buildDownloadUrl() {
  return `${UPDATE_DOWNLOAD.host}/downloads/${UPDATE_DOWNLOAD.latestFileName}`;
}
