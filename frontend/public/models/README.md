# 体育场 3D 模型

将 GLB 文件放到本目录：

```
dayuntest1.glb
```

完整路径：`frontend/public/models/dayuntest1.glb`  
浏览器访问：`http://localhost:5174/models/dayuntest1.glb`

若模型位置/大小不对，在 `src/constants.ts` 的 `STADIUM_GLB` 中调整：

- `scale`：整体缩放
- `headingDegrees`：水平旋转
- `heightMeters`：相对地表高度（米），**可为负数**下沉；设为 `0` 则贴地
- `offsetEastMeters`：向东（右）平移，单位米；向西填负数
- `offsetNorthMeters`：向北（上）平移，单位米；向南填负数

修改后需**刷新浏览器**（模型在页面加载时创建）。
