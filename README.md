<p align="center">
  <img src="android/app/src/main/res/drawable/ic_launcher.png" width="88" height="88" alt="BetterNotepad 应用图标" />
</p>

<h1 align="center">BetterNotepad Android</h1>

<p align="center">
  <strong>把灵感写成便签，把事情列成清单。</strong><br />
  为手机设计的轻量便签本：文字、图片和待办，打开就能记录。
</p>

<p align="center">
  <code>v0.1.20</code> · <code>Android 8.0+</code> · <code>本地保存</code> · <a href="LICENSE">Apache-2.0</a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能亮点">功能亮点</a> ·
  <a href="#开发与构建">开发构建</a> ·
  <a href="#发布与更新">发布更新</a> ·
  <a href="#数据与隐私">数据隐私</a>
</p>

---

BetterNotepad Android 是独立的移动端项目。不同于电脑端的文件 Tab，手机主页直接展示便签卡片；点击卡片即可进入编辑，文字与图片统一操作，不需要编写 Markdown。

> **当前状态**：0.1.20 已构建并通过回归测试。检查更新的入口与下载／安装流程已实现，但 Release 更新源尚未配置；小米真机兼容性和真实更新安装仍待验证。

## 快速开始

1. **安装**：如本仓库已发布 Release，从 Releases 下载 APK；尚未发布时，可按[构建说明](#开发与构建)自行生成安装包。
2. **记录**：新建便签，输入文字；将光标放在需要插图的位置，点击「+」选择照片，也可以添加标签和待办。
3. **备份**：在设置中导出 ZIP，保存到应用之外。回收站、备份恢复和更新入口都在设置中，主页保持简洁。

最低支持 **Android 8.0（API 26）**，需要 Android System WebView／Chrome。APK 不含架构专用原生库，可用于 ARM 和 x86 设备。

> **更新不要先卸载。** 使用同一签名的更高版本 APK 覆盖安装。卸载或清除应用数据会删除本机便签、图片和回收站，请先导出重要内容。

## 功能亮点

| 功能 | 说明 |
| --- | --- |
| **卡片主页** | 新建、自动保存、置顶与批量删除；点击「排列」，拖动卡片手柄交换位置，也可用前移／后移按钮调整。 |
| **文字与图片** | 直接编辑、撤销／重做，在光标位置插图；点击图片全屏查看，支持缩放、拖动和双击复原。 |
| **相册选图** | 切换本地相册，按最近添加时间排序，滚动继续加载；保留系统选图入口。 |
| **标签与待办** | 按标签分类，添加和勾选待办，主页显示完成进度。标签用于分类，不参与拖动排序。 |
| **独立搜索** | 搜索便签标题、正文、标签和待办内容，不常驻占用主页空间。 |
| **备份与回收站** | ZIP 备份包含便签、图片、回收站和已保存设置；恢复可合并或确认后替换。删除先进入回收站，不自动清空。 |
| **桌面小组件** | 查看一篇便签的摘要、图片和待办，直接勾选或打开编辑；支持多个小组件和更换便签。 |
| **主题与文案** | 暖色、浅色、深色三套主题；在设置中修改主页标题和副标题。 |
| **检查更新** | 手动检查 GitHub 正式 Release，显示下载进度并打开系统安装界面；更新源当前留空，不自动检查。 |

## 数据与隐私

- **内容保存在本机**：正文与已导入图片位于应用私有目录，不依赖原相册照片或临时访问权限。无账号、云同步或自建服务器，前端资源随 APK 打包。
- **保存异常会提示**：便签使用 `AtomicFile` 写入；读取损坏或保存失败时显示错误，不用空白数据覆盖已有内容。
- **按功能申请权限**：打开应用内相册时申请照片读取权限，部分授权时仅显示获准访问的照片；网络权限用于用户主动检查／下载更新，安装权限由系统单独授权。
- **不扩大文件访问范围**：不申请视频、存储写入或所有文件访问权限，不加载远程正文图片或嵌入页面。Android 12 及更旧版本的外部存储读取权限限制到 API 32。

**ZIP 备份未加密**，请妥善保管。桌面小组件的绑定关系不包含在备份中。

## 开发与构建

**前端**：React 19 · TypeScript · CodeMirror 6 · Vite<br />
**原生**：Java Activity · WebView · Android 平台 SDK

当前构建与测试脚本面向 **Windows／PowerShell**，不使用 Gradle、NDK 或 Rust。

### 环境准备

| 依赖 | 要求 |
| --- | --- |
| Node.js / npm | 用于安装前端依赖、构建与测试 |
| JDK | 17，`JAVA_HOME` 指向 JDK 根目录，而不是 `bin` |
| Android SDK Platform | 34 |
| Android Build-Tools | 34.0.0 |

在仓库根目录运行，环境路径按本机安装位置修改：

```powershell
$env:JAVA_HOME = 'C:\Program Files\Java\jdk-17'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

npm.cmd ci
npm.cmd test
npm.cmd run android:build
```

当前安装包输出为 `artifacts/BetterNotepad-Android-0.1.20.apk`。

<details>
<summary>常用命令与目录结构</summary>

| 命令 | 用途 |
| --- | --- |
| `npm.cmd run dev` | 浏览器开发预览，默认 `http://127.0.0.1:1430` |
| `npm.cmd run build` | TypeScript 检查与网页生产构建 |
| `npm.cmd test` | Node／DOM、原生 Java 边界和 APK 资源路径回归测试 |
| `npm.cmd run android:build` | 构建、对齐、签名并验证 APK |

也可以显式指定环境目录：

```powershell
npm.cmd run android:build -- -Sdk '<Android SDK 目录>' -JavaHome '<JDK 17 根目录>'
```

```text
android/app/src/main/   Android 代码、Manifest 与资源
src/                    便签界面、编辑器与数据逻辑
scripts/                APK 构建与资源检查脚本
tests/                  回归测试及 Android 边界模拟
package-lock.json       固定前端依赖版本
```

浏览器预览不支持原生相册、文件备份、小组件和 APK 安装。首次运行 Java 测试会下载固定版本、经过 SHA-256 校验的 `org.json` 测试依赖到 `build/test-dependencies/`；它不会打入 APK。

`node_modules/`、`dist/`、`build/`、`artifacts/` 与本地开发工具记录不纳入 Git。APK 作为 Release 附件发布，不提交到源码仓库。

</details>

### 保留签名密钥

构建脚本使用 `build/local-debug.keystore`，缺失时会生成新的本地测试密钥。**后续发布必须继续使用原密钥，并在仓库之外可靠备份**，否则已有安装无法同签名覆盖更新。密钥不纳入 Git，不要为了清理缓存删除整个 `build/` 目录。

当前 APK 使用本地测试签名，不是应用商店发布包。正式发布需另行准备签名方案，不能直接更换已有用户的更新密钥。

## 发布与更新

### 接入更新源

`android/app/src/main/res/values/strings.xml` 中的 `update_repository` **当前为空**。未配置时，「检查更新」只提示更新源未配置，不发起网络请求。

拿到 GitHub 仓库地址后，按以下示例填入仓库标识，再重新构建 APK：

```xml
<string name="update_repository" translatable="false">owner/repository</string>
```

上面仅为配置示例，并非已启用的更新源。应用不收集 GitHub Token，仅支持公开仓库的正式 Release。

### 发布约定

以 `0.1.21` 为例：

1. 同步修改 `package.json`、`package-lock.json` 与 Android Manifest 的版本名，增加 Manifest 的 `versionCode`。
2. 使用原签名密钥构建**单个完整 APK**。
3. 创建非 Draft、非 Pre-release 的 Release，Tag 为 `v0.1.21` 或 `0.1.21`。
4. 上传 `BetterNotepad-Android-0.1.21.apk`，APK 的 `versionName` 必须为 `0.1.21`，`versionCode` 高于已安装版本。

更新器不会使用 ZIP、Windows 安装包或 split APK。Tag 必须采用三段数字版本，APK 附件命名必须与版本匹配。

<details>
<summary>更新流程与安装包校验</summary>

用户流程：**设置 → 检查更新 → 下载更新 → 安装更新**。下载可取消；首次安装更新时在系统设置允许本应用安装未知应用，返回后点「继续安装」，最后由系统确认。不能静默更新，打开安装器也不代表安装成功；实际版本以重启后的显示为准。

更新器调用 GitHub latest Release API，只接受 HTTPS GitHub 及其下载 CDN，安装包上限为 100 MB。应用会校验下载长度、Release 提供的 SHA-256（如有）、包名、更高的版本码、最低 Android 版本和签名，安装前再次核对缓存哈希。系统安装器仅获得该 APK 的临时只读访问权限。

</details>

## 常见问题

**小米桌面找不到小组件？**<br />
部分小米桌面需要从「支持小部件应用 → 全部 → 安卓小部件」入口添加。应用内发起请求不代表桌面已添加成功；识别与触摸兼容性仍需真机验证。

**选图时照片不全？**<br />
先检查照片授权范围，再切换相册或向下滚动继续加载；也可使用相册页的系统选图入口。应用内相册显示当前已授权的本地照片。

**删除的便签能找回吗？**<br />
可在设置的回收站中恢复；彻底删除或清空后不能通过回收站恢复，只能使用此前导出的备份。

## 验证范围

0.1.20 的 **221 项 Node／DOM／JVM 测试 + 4 项 APK 资源路径测试**通过，APK 的网页资源、版本和签名已校验。

浏览器检查覆盖手机尺寸布局，**不等于小米触屏或系统安装验收**。真实 Release 下载及小米真机覆盖安装尚未验证。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。
