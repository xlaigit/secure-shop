// AI Drawing Recipes - each word has stroke-by-stroke drawing instructions
window.aiDrawingRecipes = {
  // ============== 动物 ==============
  "猫": {
    category: "动物",
    strokes: [
      // 身体 (椭圆)
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.18, ry: 0.22, color: "#FF8C00", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.18, ry: 0.22, color: "#FFB347" },
      // 头部 (圆)
      { type: "circle", x: 0.5, y: 0.32, r: 0.14, color: "#FF8C00", width: 3 },
      { type: "fill", x: 0.5, y: 0.32, r: 0.14, color: "#FFB347" },
      // 左耳 (三角形)
      { type: "triangle", x: 0.38, y: 0.24, w: 0.12, h: 0.12, color: "#FF8C00", width: 2 },
      { type: "fill", x: 0.38, y: 0.24, w: 0.12, h: 0.12, color: "#FFB347" },
      // 右耳 (三角形)
      { type: "triangle", x: 0.62, y: 0.24, w: 0.12, h: 0.12, color: "#FF8C00", width: 2 },
      { type: "fill", x: 0.62, y: 0.24, w: 0.12, h: 0.12, color: "#FFB347" },
      // 左眼
      { type: "circle", x: 0.45, y: 0.3, r: 0.025, color: "#333", width: 2 },
      { type: "fill", x: 0.45, y: 0.3, r: 0.025, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.3, r: 0.025, color: "#333", width: 2 },
      { type: "fill", x: 0.55, y: 0.3, r: 0.025, color: "#333" },
      // 鼻子
      { type: "circle", x: 0.5, y: 0.35, r: 0.008, color: "#FF69B4", width: 1 },
      { type: "fill", x: 0.5, y: 0.35, r: 0.008, color: "#FF69B4" },
      // 嘴巴
      { type: "arc", x: 0.5, y: 0.37, r: 0.03, start: 0.2, end: 2.9, color: "#333", width: 1.5 },
      // 胡须左
      { type: "line", x: 0.35, y: 0.3, x2: 0.42, y2: 0.35, color: "#666", width: 1 },
      { type: "line", x: 0.35, y: 0.35, x2: 0.42, y2: 0.36, color: "#666", width: 1 },
      { type: "line", x: 0.35, y: 0.4, x2: 0.42, y2: 0.37, color: "#666", width: 1 },
      // 胡须右
      { type: "line", x: 0.65, y: 0.3, x2: 0.58, y2: 0.35, color: "#666", width: 1 },
      { type: "line", x: 0.65, y: 0.35, x2: 0.58, y2: 0.36, color: "#666", width: 1 },
      { type: "line", x: 0.65, y: 0.4, x2: 0.58, y2: 0.37, color: "#666", width: 1 },
      // 尾巴
      { type: "arc", x: 0.72, y: 0.55, r: 0.12, start: 0.5, end: 2.5, color: "#FF8C00", width: 3 },
      // 前腿左
      { type: "line", x: 0.42, y: 0.78, x2: 0.44, y2: 0.55, color: "#FF8C00", width: 3 },
      // 前腿右
      { type: "line", x: 0.58, y: 0.78, x2: 0.56, y2: 0.55, color: "#FF8C00", width: 3 },
      // 后腿左
      { type: "line", x: 0.44, y: 0.82, x2: 0.44, y2: 0.7, color: "#FF8C00", width: 3 },
      { type: "line", x: 0.56, y: 0.82, x2: 0.56, y2: 0.7, color: "#FF8C00", width: 3 },
    ]
  },
  "狗": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.2, ry: 0.18, color: "#8B4513", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.2, ry: 0.18, color: "#A0522D" },
      // 头部
      { type: "ellipse", x: 0.5, y: 0.35, rx: 0.14, ry: 0.12, color: "#8B4513", width: 3 },
      { type: "fill", x: 0.5, y: 0.35, rx: 0.14, ry: 0.12, color: "#A0522D" },
      // 左耳 (垂耳)
      { type: "ellipse", x: 0.38, y: 0.27, rx: 0.05, ry: 0.08, color: "#5C3317", width: 2 },
      { type: "fill", x: 0.38, y: 0.27, rx: 0.05, ry: 0.08, color: "#5C3317" },
      // 右耳
      { type: "ellipse", x: 0.62, y: 0.27, rx: 0.05, ry: 0.08, color: "#5C3317", width: 2 },
      { type: "fill", x: 0.62, y: 0.27, rx: 0.05, ry: 0.08, color: "#5C3317" },
      // 左眼
      { type: "circle", x: 0.45, y: 0.33, r: 0.022, color: "#333", width: 2 },
      { type: "fill", x: 0.45, y: 0.33, r: 0.022, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.33, r: 0.022, color: "#333", width: 2 },
      { type: "fill", x: 0.55, y: 0.33, r: 0.022, color: "#333" },
      // 鼻子
      { type: "ellipse", x: 0.5, y: 0.39, rx: 0.02, ry: 0.015, color: "#333", width: 2 },
      { type: "fill", x: 0.5, y: 0.39, rx: 0.02, ry: 0.015, color: "#333" },
      // 嘴巴
      { type: "arc", x: 0.5, y: 0.42, r: 0.03, start: 0.3, end: 2.8, color: "#333", width: 1.5 },
      // 舌头
      { type: "ellipse", x: 0.5, y: 0.45, rx: 0.015, ry: 0.02, color: "#FF6B6B", width: 1 },
      { type: "fill", x: 0.5, y: 0.45, rx: 0.015, ry: 0.02, color: "#FF6B6B" },
      // 前腿左
      { type: "line", x: 0.42, y: 0.78, x2: 0.42, y2: 0.55, color: "#8B4513", width: 3.5 },
      // 前腿右
      { type: "line", x: 0.58, y: 0.78, x2: 0.58, y2: 0.55, color: "#8B4513", width: 3.5 },
      // 后腿左
      { type: "line", x: 0.38, y: 0.78, x2: 0.38, y2: 0.68, color: "#8B4513", width: 3.5 },
      // 后腿右
      { type: "line", x: 0.62, y: 0.78, x2: 0.62, y2: 0.68, color: "#8B4513", width: 3.5 },
      // 尾巴 (翘起)
      { type: "arc", x: 0.75, y: 0.5, r: 0.1, start: 0.8, end: 2.8, color: "#8B4513", width: 3 },
    ]
  },
  "兔子": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.65, rx: 0.15, ry: 0.18, color: "#E8E8E8", width: 2 },
      { type: "fill", x: 0.5, y: 0.65, rx: 0.15, ry: 0.18, color: "#F5F5F5" },
      // 头部
      { type: "circle", x: 0.5, y: 0.38, r: 0.12, color: "#E8E8E8", width: 2 },
      { type: "fill", x: 0.5, y: 0.38, r: 0.12, color: "#F5F5F5" },
      // 左耳 (长)
      { type: "ellipse", x: 0.42, y: 0.18, rx: 0.04, ry: 0.15, color: "#E8E8E8", width: 2 },
      { type: "fill", x: 0.42, y: 0.18, rx: 0.04, ry: 0.15, color: "#F5F5F5" },
      // 左耳内部
      { type: "ellipse", x: 0.42, y: 0.18, rx: 0.02, ry: 0.1, color: "#FFB6C1", width: 1 },
      { type: "fill", x: 0.42, y: 0.18, rx: 0.02, ry: 0.1, color: "#FFB6C1" },
      // 右耳 (长)
      { type: "ellipse", x: 0.58, y: 0.18, rx: 0.04, ry: 0.15, color: "#E8E8E8", width: 2 },
      { type: "fill", x: 0.58, y: 0.18, rx: 0.04, ry: 0.15, color: "#F5F5F5" },
      // 右耳内部
      { type: "ellipse", x: 0.58, y: 0.18, rx: 0.02, ry: 0.1, color: "#FFB6C1", width: 1 },
      { type: "fill", x: 0.58, y: 0.18, rx: 0.02, ry: 0.1, color: "#FFB6C1" },
      // 左眼
      { type: "circle", x: 0.45, y: 0.36, r: 0.02, color: "#FF69B4", width: 2 },
      { type: "fill", x: 0.45, y: 0.36, r: 0.02, color: "#FF69B4" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.36, r: 0.02, color: "#FF69B4", width: 2 },
      { type: "fill", x: 0.55, y: 0.36, r: 0.02, color: "#FF69B4" },
      // 鼻子
      { type: "circle", x: 0.5, y: 0.4, r: 0.006, color: "#FF69B4", width: 1 },
      { type: "fill", x: 0.5, y: 0.4, r: 0.006, color: "#FF69B4" },
      // 嘴巴
      { type: "line", x: 0.5, y: 0.4, x2: 0.5, y2: 0.43, color: "#999", width: 1 },
      { type: "arc", x: 0.47, y: 0.43, r: 0.02, start: 0, end: 3.14, color: "#999", width: 1 },
      { type: "arc", x: 0.53, y: 0.43, r: 0.02, start: 0, end: 3.14, color: "#999", width: 1 },
      // 前腿左
      { type: "line", x: 0.43, y: 0.8, x2: 0.43, y2: 0.6, color: "#E8E8E8", width: 2.5 },
      // 前腿右
      { type: "line", x: 0.57, y: 0.8, x2: 0.57, y2: 0.6, color: "#E8E8E8", width: 2.5 },
      // 尾巴 (圆球)
      { type: "circle", x: 0.5, y: 0.82, r: 0.03, color: "#E8E8E8", width: 2 },
      { type: "fill", x: 0.5, y: 0.82, r: 0.03, color: "#FFF" },
    ]
  },
  "大象": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.55, rx: 0.22, ry: 0.18, color: "#808080", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, rx: 0.22, ry: 0.18, color: "#A9A9A9" },
      // 头部
      { type: "circle", x: 0.5, y: 0.32, r: 0.15, color: "#808080", width: 3 },
      { type: "fill", x: 0.5, y: 0.32, r: 0.15, color: "#A9A9A9" },
      // 左耳 (大)
      { type: "ellipse", x: 0.33, y: 0.32, rx: 0.08, ry: 0.12, color: "#808080", width: 2.5 },
      { type: "fill", x: 0.33, y: 0.32, rx: 0.08, ry: 0.12, color: "#A9A9A9" },
      // 右耳
      { type: "ellipse", x: 0.67, y: 0.32, rx: 0.08, ry: 0.12, color: "#808080", width: 2.5 },
      { type: "fill", x: 0.67, y: 0.32, rx: 0.08, ry: 0.12, color: "#A9A9A9" },
      // 鼻子 (象鼻)
      { type: "arc", x: 0.5, y: 0.45, r: 0.12, start: 0.2, end: 1.8, color: "#808080", width: 4 },
      // 左眼
      { type: "circle", x: 0.46, y: 0.3, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.46, y: 0.3, r: 0.015, color: "#333" },
      // 右眼
      { type: "circle", x: 0.54, y: 0.3, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.54, y: 0.3, r: 0.015, color: "#333" },
      // 象牙左
      { type: "line", x: 0.45, y: 0.4, x2: 0.42, y2: 0.48, color: "#FFFFF0", width: 2.5 },
      // 象牙右
      { type: "line", x: 0.55, y: 0.4, x2: 0.58, y2: 0.48, color: "#FFFFF0", width: 2.5 },
      // 前腿左
      { type: "rect", x: 0.4, y: 0.7, w: 0.06, h: 0.15, color: "#808080", width: 2.5 },
      { type: "fill", x: 0.4, y: 0.7, w: 0.06, h: 0.15, color: "#A9A9A9" },
      // 前腿右
      { type: "rect", x: 0.54, y: 0.7, w: 0.06, h: 0.15, color: "#808080", width: 2.5 },
      { type: "fill", x: 0.54, y: 0.7, w: 0.06, h: 0.15, color: "#A9A9A9" },
      // 尾巴
      { type: "line", x: 0.72, y: 0.5, x2: 0.78, y2: 0.55, color: "#808080", width: 2 },
    ]
  },
  "长颈鹿": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.7, rx: 0.18, ry: 0.12, color: "#DAA520", width: 3 },
      { type: "fill", x: 0.5, y: 0.7, rx: 0.18, ry: 0.12, color: "#FFD700" },
      // 脖子 (长)
      { type: "rect", x: 0.45, y: 0.28, w: 0.1, h: 0.42, color: "#DAA520", width: 3 },
      { type: "fill", x: 0.45, y: 0.28, w: 0.1, h: 0.42, color: "#FFD700" },
      // 头部
      { type: "ellipse", x: 0.5, y: 0.22, rx: 0.1, ry: 0.07, color: "#DAA520", width: 3 },
      { type: "fill", x: 0.5, y: 0.22, rx: 0.1, ry: 0.07, color: "#FFD700" },
      // 左眼
      { type: "circle", x: 0.47, y: 0.2, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.47, y: 0.2, r: 0.015, color: "#333" },
      // 右眼
      { type: "circle", x: 0.53, y: 0.2, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.53, y: 0.2, r: 0.015, color: "#333" },
      // 角左
      { type: "line", x: 0.47, y: 0.17, x2: 0.45, y2: 0.1, color: "#8B4513", width: 2.5 },
      { type: "circle", x: 0.45, y: 0.09, r: 0.008, color: "#8B4513", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.09, r: 0.008, color: "#8B4513" },
      // 角右
      { type: "line", x: 0.53, y: 0.17, x2: 0.55, y2: 0.1, color: "#8B4513", width: 2.5 },
      { type: "circle", x: 0.55, y: 0.09, r: 0.008, color: "#8B4513", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.09, r: 0.008, color: "#8B4513" },
      // 耳朵
      { type: "ellipse", x: 0.38, y: 0.2, rx: 0.025, ry: 0.015, color: "#DAA520", width: 1.5 },
      { type: "fill", x: 0.38, y: 0.2, rx: 0.025, ry: 0.015, color: "#FFD700" },
      { type: "ellipse", x: 0.62, y: 0.2, rx: 0.025, ry: 0.015, color: "#DAA520", width: 1.5 },
      { type: "fill", x: 0.62, y: 0.2, rx: 0.025, ry: 0.015, color: "#FFD700" },
      // 斑点
      { type: "circle", x: 0.47, y: 0.35, r: 0.015, color: "#8B4513", width: 1 },
      { type: "fill", x: 0.47, y: 0.35, r: 0.015, color: "#8B4513" },
      { type: "circle", x: 0.53, y: 0.42, r: 0.015, color: "#8B4513", width: 1 },
      { type: "fill", x: 0.53, y: 0.42, r: 0.015, color: "#8B4513" },
      { type: "circle", x: 0.47, y: 0.5, r: 0.015, color: "#8B4513", width: 1 },
      { type: "fill", x: 0.47, y: 0.5, r: 0.015, color: "#8B4513" },
      { type: "circle", x: 0.53, y: 0.58, r: 0.015, color: "#8B4513", width: 1 },
      { type: "fill", x: 0.53, y: 0.58, r: 0.015, color: "#8B4513" },
      // 前腿左
      { type: "line", x: 0.42, y: 0.82, x2: 0.42, y2: 0.7, color: "#DAA520", width: 3 },
      // 前腿右
      { type: "line", x: 0.58, y: 0.82, x2: 0.58, y2: 0.7, color: "#DAA520", width: 3 },
      // 后腿左
      { type: "line", x: 0.38, y: 0.82, x2: 0.38, y2: 0.72, color: "#DAA520", width: 3 },
      // 后腿右
      { type: "line", x: 0.62, y: 0.82, x2: 0.62, y2: 0.72, color: "#DAA520", width: 3 },
      // 尾巴
      { type: "line", x: 0.68, y: 0.7, x2: 0.72, y2: 0.65, color: "#DAA520", width: 2 },
    ]
  },
  "企鹅": {
    category: "动物",
    strokes: [
      // 身体 (黑色椭圆)
      { type: "ellipse", x: 0.5, y: 0.55, rx: 0.14, ry: 0.22, color: "#333", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, rx: 0.14, ry: 0.22, color: "#333" },
      // 肚子 (白色)
      { type: "ellipse", x: 0.5, y: 0.58, rx: 0.09, ry: 0.16, color: "#FFF", width: 2 },
      { type: "fill", x: 0.5, y: 0.58, rx: 0.09, ry: 0.16, color: "#FFF" },
      // 头部
      { type: "circle", x: 0.5, y: 0.28, r: 0.1, color: "#333", width: 3 },
      { type: "fill", x: 0.5, y: 0.28, r: 0.1, color: "#333" },
      // 脸部白色 (心形)
      { type: "ellipse", x: 0.5, y: 0.32, rx: 0.06, ry: 0.05, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.32, rx: 0.06, ry: 0.05, color: "#FFF" },
      // 左眼
      { type: "circle", x: 0.47, y: 0.27, r: 0.015, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.47, y: 0.27, r: 0.015, color: "#FFF" },
      { type: "circle", x: 0.47, y: 0.27, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.47, y: 0.27, r: 0.008, color: "#333" },
      // 右眼
      { type: "circle", x: 0.53, y: 0.27, r: 0.015, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.53, y: 0.27, r: 0.015, color: "#FFF" },
      { type: "circle", x: 0.53, y: 0.27, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.53, y: 0.27, r: 0.008, color: "#333" },
      // 嘴巴 (三角形)
      { type: "triangle", x: 0.5, y: 0.33, w: 0.06, h: 0.04, color: "#FF8C00", width: 2 },
      { type: "fill", x: 0.5, y: 0.33, w: 0.06, h: 0.04, color: "#FFA500" },
      // 左翅膀
      { type: "arc", x: 0.33, y: 0.5, r: 0.08, start: 1.5, end: 3.5, color: "#333", width: 3.5 },
      // 右翅膀
      { type: "arc", x: 0.67, y: 0.5, r: 0.08, start: 2.8, end: 4.8, color: "#333", width: 3.5 },
      // 左脚
      { type: "ellipse", x: 0.47, y: 0.78, rx: 0.03, ry: 0.015, color: "#FF8C00", width: 1.5 },
      { type: "fill", x: 0.47, y: 0.78, rx: 0.03, ry: 0.015, color: "#FFA500" },
      // 右脚
      { type: "ellipse", x: 0.53, y: 0.78, rx: 0.03, ry: 0.015, color: "#FF8C00", width: 1.5 },
      { type: "fill", x: 0.53, y: 0.78, rx: 0.03, ry: 0.015, color: "#FFA500" },
    ]
  },
  "海豚": {
    category: "动物",
    strokes: [
      // 身体 (流线型)
      { type: "ellipse", x: 0.5, y: 0.5, rx: 0.25, ry: 0.1, color: "#4682B4", width: 3 },
      { type: "fill", x: 0.5, y: 0.5, rx: 0.25, ry: 0.1, color: "#5B9BD5" },
      // 肚子 (浅色)
      { type: "ellipse", x: 0.5, y: 0.54, rx: 0.2, ry: 0.05, color: "#B0E0E6", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.54, rx: 0.2, ry: 0.05, color: "#B0E0E6" },
      // 头部 (嘴)
      { type: "ellipse", x: 0.2, y: 0.48, rx: 0.06, ry: 0.04, color: "#4682B4", width: 2 },
      { type: "fill", x: 0.2, y: 0.48, rx: 0.06, ry: 0.04, color: "#4682B4" },
      // 嘴巴
      { type: "line", x: 0.15, y: 0.48, x2: 0.25, y2: 0.48, color: "#333", width: 1.5 },
      // 眼睛
      { type: "circle", x: 0.28, y: 0.45, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.28, y: 0.45, r: 0.015, color: "#333" },
      // 背鳍
      { type: "triangle", x: 0.5, y: 0.35, w: 0.08, h: 0.1, color: "#4682B4", width: 2 },
      { type: "fill", x: 0.5, y: 0.35, w: 0.08, h: 0.1, color: "#4682B4" },
      // 尾鳍 (V形)
      { type: "line", x: 0.78, y: 0.5, x2: 0.85, y2: 0.42, color: "#4682B4", width: 3 },
      { type: "line", x: 0.78, y: 0.5, x2: 0.85, y2: 0.58, color: "#4682B4", width: 3 },
      // 胸鳍
      { type: "line", x: 0.4, y: 0.55, x2: 0.38, y2: 0.62, color: "#4682B4", width: 2.5 },
      // 水花
      { type: "circle", x: 0.12, y: 0.42, r: 0.015, color: "#87CEEB", width: 1 },
      { type: "circle", x: 0.08, y: 0.38, r: 0.01, color: "#87CEEB", width: 1 },
      { type: "circle", x: 0.15, y: 0.38, r: 0.012, color: "#87CEEB", width: 1 },
    ]
  },
  "蝴蝶": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.5, rx: 0.03, ry: 0.15, color: "#333", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.5, rx: 0.03, ry: 0.15, color: "#333" },
      // 左上翅
      { type: "ellipse", x: 0.35, y: 0.38, rx: 0.15, ry: 0.12, color: "#FF69B4", width: 2.5 },
      { type: "fill", x: 0.35, y: 0.38, rx: 0.15, ry: 0.12, color: "#FF69B4" },
      // 左上翅花纹
      { type: "circle", x: 0.35, y: 0.38, r: 0.04, color: "#FF1493", width: 1.5 },
      { type: "fill", x: 0.35, y: 0.38, r: 0.04, color: "#FF1493" },
      // 右上翅
      { type: "ellipse", x: 0.65, y: 0.38, rx: 0.15, ry: 0.12, color: "#FF69B4", width: 2.5 },
      { type: "fill", x: 0.65, y: 0.38, rx: 0.15, ry: 0.12, color: "#FF69B4" },
      // 右上翅花纹
      { type: "circle", x: 0.65, y: 0.38, r: 0.04, color: "#FF1493", width: 1.5 },
      { type: "fill", x: 0.65, y: 0.38, r: 0.04, color: "#FF1493" },
      // 左下翅
      { type: "ellipse", x: 0.38, y: 0.62, rx: 0.12, ry: 0.1, color: "#9370DB", width: 2.5 },
      { type: "fill", x: 0.38, y: 0.62, rx: 0.12, ry: 0.1, color: "#9370DB" },
      // 左下翅花纹
      { type: "circle", x: 0.38, y: 0.62, r: 0.03, color: "#7B68EE", width: 1.5 },
      { type: "fill", x: 0.38, y: 0.62, r: 0.03, color: "#7B68EE" },
      // 右下翅
      { type: "ellipse", x: 0.62, y: 0.62, rx: 0.12, ry: 0.1, color: "#9370DB", width: 2.5 },
      { type: "fill", x: 0.62, y: 0.62, rx: 0.12, ry: 0.1, color: "#9370DB" },
      // 右下翅花纹
      { type: "circle", x: 0.62, y: 0.62, r: 0.03, color: "#7B68EE", width: 1.5 },
      { type: "fill", x: 0.62, y: 0.62, r: 0.03, color: "#7B68EE" },
      // 触角左
      { type: "arc", x: 0.45, y: 0.35, r: 0.06, start: 3.5, end: 5.5, color: "#333", width: 1.5 },
      { type: "circle", x: 0.4, y: 0.33, r: 0.006, color: "#333", width: 1 },
      { type: "fill", x: 0.4, y: 0.33, r: 0.006, color: "#333" },
      // 触角右
      { type: "arc", x: 0.55, y: 0.35, r: 0.06, start: 0.8, end: 2.8, color: "#333", width: 1.5 },
      { type: "circle", x: 0.6, y: 0.33, r: 0.006, color: "#333", width: 1 },
      { type: "fill", x: 0.6, y: 0.33, r: 0.006, color: "#333" },
    ]
  },
  "老鹰": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.55, rx: 0.1, ry: 0.18, color: "#5C3317", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, rx: 0.1, ry: 0.18, color: "#5C3317" },
      // 头部
      { type: "circle", x: 0.5, y: 0.3, r: 0.08, color: "#5C3317", width: 3 },
      { type: "fill", x: 0.5, y: 0.3, r: 0.08, color: "#5C3317" },
      // 左翅 (展开)
      { type: "line", x: 0.4, y: 0.5, x2: 0.15, y2: 0.35, color: "#5C3317", width: 4 },
      { type: "line", x: 0.15, y: 0.35, x2: 0.12, y2: 0.45, color: "#5C3317", width: 3 },
      { type: "line", x: 0.15, y: 0.35, x2: 0.18, y2: 0.25, color: "#5C3317", width: 2 },
      // 右翅 (展开)
      { type: "line", x: 0.6, y: 0.5, x2: 0.85, y2: 0.35, color: "#5C3317", width: 4 },
      { type: "line", x: 0.85, y: 0.35, x2: 0.88, y2: 0.45, color: "#5C3317", width: 3 },
      { type: "line", x: 0.85, y: 0.35, x2: 0.82, y2: 0.25, color: "#5C3317", width: 2 },
      // 左翅羽毛
      { type: "line", x: 0.2, y: 0.38, x2: 0.15, y2: 0.48, color: "#5C3317", width: 2 },
      { type: "line", x: 0.25, y: 0.4, x2: 0.2, y2: 0.5, color: "#5C3317", width: 2 },
      // 右翅羽毛
      { type: "line", x: 0.8, y: 0.38, x2: 0.85, y2: 0.48, color: "#5C3317", width: 2 },
      { type: "line", x: 0.75, y: 0.4, x2: 0.8, y2: 0.5, color: "#5C3317", width: 2 },
      // 眼睛
      { type: "circle", x: 0.5, y: 0.28, r: 0.015, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.28, r: 0.015, color: "#FFD700" },
      { type: "circle", x: 0.5, y: 0.28, r: 0.007, color: "#333", width: 1 },
      { type: "fill", x: 0.5, y: 0.28, r: 0.007, color: "#333" },
      // 喙 (钩状)
      { type: "triangle", x: 0.5, y: 0.34, w: 0.06, h: 0.04, color: "#FF8C00", width: 2 },
      { type: "fill", x: 0.5, y: 0.34, w: 0.06, h: 0.04, color: "#FFA500" },
      // 尾巴
      { type: "triangle", x: 0.5, y: 0.75, w: 0.12, h: 0.06, color: "#5C3317", width: 2 },
      { type: "fill", x: 0.5, y: 0.75, w: 0.12, h: 0.06, color: "#5C3317" },
      // 爪子
      { type: "line", x: 0.47, y: 0.7, x2: 0.45, y2: 0.78, color: "#FF8C00", width: 2 },
      { type: "line", x: 0.53, y: 0.7, x2: 0.55, y2: 0.78, color: "#FF8C00", width: 2 },
    ]
  },
  "孔雀": {
    category: "动物",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.1, ry: 0.16, color: "#1E90FF", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.1, ry: 0.16, color: "#4169E1" },
      // 头部
      { type: "circle", x: 0.5, y: 0.38, r: 0.06, color: "#1E90FF", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.38, r: 0.06, color: "#4169E1" },
      // 冠羽
      { type: "line", x: 0.5, y: 0.33, x2: 0.5, y2: 0.26, color: "#1E90FF", width: 1.5 },
      { type: "circle", x: 0.5, y: 0.25, r: 0.008, color: "#1E90FF", width: 1 },
      { type: "fill", x: 0.5, y: 0.25, r: 0.008, color: "#4169E1" },
      { type: "line", x: 0.48, y: 0.33, x2: 0.46, y2: 0.27, color: "#1E90FF", width: 1.5 },
      { type: "circle", x: 0.46, y: 0.26, r: 0.008, color: "#1E90FF", width: 1 },
      { type: "fill", x: 0.46, y: 0.26, r: 0.008, color: "#4169E1" },
      { type: "line", x: 0.52, y: 0.33, x2: 0.54, y2: 0.27, color: "#1E90FF", width: 1.5 },
      { type: "circle", x: 0.54, y: 0.26, r: 0.008, color: "#1E90FF", width: 1 },
      { type: "fill", x: 0.54, y: 0.26, r: 0.008, color: "#4169E1" },
      // 眼睛
      { type: "circle", x: 0.5, y: 0.37, r: 0.01, color: "#FFF", width: 1 },
      { type: "fill", x: 0.5, y: 0.37, r: 0.01, color: "#FFF" },
      { type: "circle", x: 0.5, y: 0.37, r: 0.005, color: "#333", width: 1 },
      { type: "fill", x: 0.5, y: 0.37, r: 0.005, color: "#333" },
      // 喙
      { type: "triangle", x: 0.5, y: 0.42, w: 0.04, h: 0.025, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.42, w: 0.04, h: 0.025, color: "#FFD700" },
      // 屏羽 (大扇形) - 用多个弧线表示
      { type: "arc", x: 0.5, y: 0.5, r: 0.3, start: 0.2, end: 2.9, color: "#00CED1", width: 2 },
      // 屏羽装饰 - 左
      { type: "ellipse", x: 0.3, y: 0.35, rx: 0.02, ry: 0.04, color: "#00CED1", width: 1.5 },
      { type: "fill", x: 0.3, y: 0.35, rx: 0.02, ry: 0.04, color: "#00CED1" },
      { type: "circle", x: 0.3, y: 0.35, r: 0.01, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.3, y: 0.35, r: 0.01, color: "#FFD700" },
      // 屏羽装饰 - 中左
      { type: "ellipse", x: 0.4, y: 0.28, rx: 0.02, ry: 0.04, color: "#00CED1", width: 1.5 },
      { type: "fill", x: 0.4, y: 0.28, rx: 0.02, ry: 0.04, color: "#00CED1" },
      { type: "circle", x: 0.4, y: 0.28, r: 0.01, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.4, y: 0.28, r: 0.01, color: "#FFD700" },
      // 屏羽装饰 - 中
      { type: "ellipse", x: 0.5, y: 0.25, rx: 0.02, ry: 0.04, color: "#00CED1", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.25, rx: 0.02, ry: 0.04, color: "#00CED1" },
      { type: "circle", x: 0.5, y: 0.25, r: 0.01, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.5, y: 0.25, r: 0.01, color: "#FFD700" },
      // 屏羽装饰 - 中右
      { type: "ellipse", x: 0.6, y: 0.28, rx: 0.02, ry: 0.04, color: "#00CED1", width: 1.5 },
      { type: "fill", x: 0.6, y: 0.28, rx: 0.02, ry: 0.04, color: "#00CED1" },
      { type: "circle", x: 0.6, y: 0.28, r: 0.01, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.6, y: 0.28, r: 0.01, color: "#FFD700" },
      // 屏羽装饰 - 右
      { type: "ellipse", x: 0.7, y: 0.35, rx: 0.02, ry: 0.04, color: "#00CED1", width: 1.5 },
      { type: "fill", x: 0.7, y: 0.35, rx: 0.02, ry: 0.04, color: "#00CED1" },
      { type: "circle", x: 0.7, y: 0.35, r: 0.01, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.7, y: 0.35, r: 0.01, color: "#FFD700" },
      // 腿
      { type: "line", x: 0.48, y: 0.76, x2: 0.48, y2: 0.85, color: "#FF8C00", width: 2 },
      { type: "line", x: 0.52, y: 0.76, x2: 0.52, y2: 0.85, color: "#FF8C00", width: 2 },
    ]
  },

  // ============== 食物 ==============
  "苹果": {
    category: "食物",
    strokes: [
      // 苹果身体
      { type: "circle", x: 0.5, y: 0.55, r: 0.18, color: "#DC143C", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.18, color: "#FF3B3B" },
      // 高光
      { type: "circle", x: 0.45, y: 0.48, r: 0.04, color: "#FF6B6B", width: 1 },
      { type: "fill", x: 0.45, y: 0.48, r: 0.04, color: "#FF6B6B" },
      // 凹陷
      { type: "arc", x: 0.5, y: 0.38, r: 0.025, start: 0, end: 3.14, color: "#8B0000", width: 2 },
      // 茎
      { type: "line", x: 0.5, y: 0.38, x2: 0.5, y2: 0.3, color: "#8B4513", width: 2.5 },
      // 叶子
      { type: "ellipse", x: 0.55, y: 0.33, rx: 0.04, ry: 0.02, color: "#228B22", width: 2 },
      { type: "fill", x: 0.55, y: 0.33, rx: 0.04, ry: 0.02, color: "#32CD32" },
      // 叶脉
      { type: "line", x: 0.52, y: 0.33, x2: 0.58, y2: 0.33, color: "#228B22", width: 1 },
      // 阴影
      { type: "arc", x: 0.5, y: 0.73, r: 0.16, start: 0, end: 3.14, color: "#8B0000", width: 1.5 },
      // 第二片叶子
      { type: "ellipse", x: 0.48, y: 0.35, rx: 0.03, ry: 0.015, color: "#228B22", width: 1.5 },
      { type: "fill", x: 0.48, y: 0.35, rx: 0.03, ry: 0.015, color: "#32CD32" },
    ]
  },
  "蛋糕": {
    category: "食物",
    strokes: [
      // 底层蛋糕
      { type: "rect", x: 0.35, y: 0.65, w: 0.3, h: 0.15, color: "#D2691E", width: 2.5 },
      { type: "fill", x: 0.35, y: 0.65, w: 0.3, h: 0.15, color: "#F4A460" },
      // 中层蛋糕
      { type: "rect", x: 0.38, y: 0.5, w: 0.24, h: 0.15, color: "#D2691E", width: 2.5 },
      { type: "fill", x: 0.38, y: 0.5, w: 0.24, h: 0.15, color: "#F4A460" },
      // 顶层蛋糕
      { type: "rect", x: 0.41, y: 0.38, w: 0.18, h: 0.12, color: "#D2691E", width: 2.5 },
      { type: "fill", x: 0.41, y: 0.38, w: 0.18, h: 0.12, color: "#F4A460" },
      // 奶油层1
      { type: "rect", x: 0.35, y: 0.65, w: 0.3, h: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.35, y: 0.65, w: 0.3, h: 0.04, color: "#FFF" },
      // 奶油层2
      { type: "rect", x: 0.38, y: 0.5, w: 0.24, h: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.38, y: 0.5, w: 0.24, h: 0.04, color: "#FFF" },
      // 奶油层3
      { type: "rect", x: 0.41, y: 0.38, w: 0.18, h: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.41, y: 0.38, w: 0.18, h: 0.04, color: "#FFF" },
      // 蜡烛
      { type: "rect", x: 0.48, y: 0.25, w: 0.04, h: 0.13, color: "#FF69B4", width: 2 },
      { type: "fill", x: 0.48, y: 0.25, w: 0.04, h: 0.13, color: "#FF69B4" },
      // 火焰
      { type: "ellipse", x: 0.5, y: 0.22, rx: 0.015, ry: 0.025, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.22, rx: 0.015, ry: 0.025, color: "#FFD700" },
      { type: "ellipse", x: 0.5, y: 0.2, rx: 0.008, ry: 0.015, color: "#FFA500", width: 1 },
      { type: "fill", x: 0.5, y: 0.2, rx: 0.008, ry: 0.015, color: "#FFA500" },
      // 装饰
      { type: "circle", x: 0.4, y: 0.55, r: 0.012, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.4, y: 0.55, r: 0.012, color: "#FF1493" },
      { type: "circle", x: 0.6, y: 0.55, r: 0.012, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.6, y: 0.55, r: 0.012, color: "#FF1493" },
      { type: "circle", x: 0.5, y: 0.7, r: 0.012, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.5, y: 0.7, r: 0.012, color: "#FF1493" },
    ]
  },
  "披萨": {
    category: "食物",
    strokes: [
      // 底部 (大圆)
      { type: "circle", x: 0.5, y: 0.55, r: 0.22, color: "#D2691E", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.22, color: "#F4A460" },
      // 芝士层
      { type: "circle", x: 0.5, y: 0.55, r: 0.19, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.19, color: "#FFD700" },
      // 番茄酱层
      { type: "circle", x: 0.5, y: 0.55, r: 0.17, color: "#DC143C", width: 2 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.17, color: "#DC143C" },
      // 切分线
      { type: "line", x: 0.5, y: 0.55, x2: 0.5, y2: 0.33, color: "#D2691E", width: 1.5 },
      { type: "line", x: 0.5, y: 0.55, x2: 0.72, y2: 0.5, color: "#D2691E", width: 1.5 },
      { type: "line", x: 0.5, y: 0.55, x2: 0.3, y2: 0.65, color: "#D2691E", width: 1.5 },
      // 香肠片
      { type: "circle", x: 0.45, y: 0.45, r: 0.025, color: "#8B0000", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.45, r: 0.025, color: "#8B0000" },
      { type: "circle", x: 0.6, y: 0.6, r: 0.025, color: "#8B0000", width: 1.5 },
      { type: "fill", x: 0.6, y: 0.6, r: 0.025, color: "#8B0000" },
      { type: "circle", x: 0.4, y: 0.6, r: 0.025, color: "#8B0000", width: 1.5 },
      { type: "fill", x: 0.4, y: 0.6, r: 0.025, color: "#8B0000" },
      // 蘑菇
      { type: "circle", x: 0.55, y: 0.45, r: 0.02, color: "#D2B48C", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.45, r: 0.02, color: "#D2B48C" },
      // 青椒
      { type: "circle", x: 0.5, y: 0.65, r: 0.02, color: "#228B22", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.65, r: 0.02, color: "#228B22" },
    ]
  },
  "汉堡": {
    category: "食物",
    strokes: [
      // 上层面包
      { type: "arc", x: 0.5, y: 0.25, r: 0.18, start: 3.14, end: 6.28, color: "#D2691E", width: 3 },
      { type: "fill", x: 0.5, y: 0.25, rx: 0.18, ry: 0.1, color: "#F4A460" },
      // 芝麻
      { type: "circle", x: 0.4, y: 0.22, r: 0.005, color: "#FFF8DC", width: 1 },
      { type: "fill", x: 0.4, y: 0.22, r: 0.005, color: "#FFF8DC" },
      { type: "circle", x: 0.5, y: 0.2, r: 0.005, color: "#FFF8DC", width: 1 },
      { type: "fill", x: 0.5, y: 0.2, r: 0.005, color: "#FFF8DC" },
      { type: "circle", x: 0.6, y: 0.22, r: 0.005, color: "#FFF8DC", width: 1 },
      { type: "fill", x: 0.6, y: 0.22, r: 0.005, color: "#FFF8DC" },
      // 生菜
      { type: "rect", x: 0.32, y: 0.35, w: 0.36, h: 0.05, color: "#228B22", width: 2 },
      { type: "fill", x: 0.32, y: 0.35, w: 0.36, h: 0.05, color: "#32CD32" },
      // 生菜波浪
      { type: "arc", x: 0.35, y: 0.35, r: 0.02, start: 0, end: 3.14, color: "#228B22", width: 1.5 },
      { type: "arc", x: 0.45, y: 0.35, r: 0.02, start: 0, end: 3.14, color: "#228B22", width: 1.5 },
      { type: "arc", x: 0.55, y: 0.35, r: 0.02, start: 0, end: 3.14, color: "#228B22", width: 1.5 },
      { type: "arc", x: 0.65, y: 0.35, r: 0.02, start: 0, end: 3.14, color: "#228B22", width: 1.5 },
      // 芝士
      { type: "rect", x: 0.33, y: 0.4, w: 0.34, h: 0.04, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.33, y: 0.4, w: 0.34, h: 0.04, color: "#FFD700" },
      // 肉饼
      { type: "rect", x: 0.34, y: 0.45, w: 0.32, h: 0.06, color: "#8B4513", width: 2.5 },
      { type: "fill", x: 0.34, y: 0.45, w: 0.32, h: 0.06, color: "#A0522D" },
      // 番茄
      { type: "rect", x: 0.33, y: 0.52, w: 0.34, h: 0.04, color: "#DC143C", width: 2 },
      { type: "fill", x: 0.33, y: 0.52, w: 0.34, h: 0.04, color: "#DC143C" },
      // 下层面包
      { type: "rect", x: 0.32, y: 0.57, w: 0.36, h: 0.08, color: "#D2691E", width: 2.5 },
      { type: "fill", x: 0.32, y: 0.57, w: 0.36, h: 0.08, color: "#F4A460" },
      // 底部弧线
      { type: "arc", x: 0.5, y: 0.65, r: 0.18, start: 0, end: 3.14, color: "#D2691E", width: 2.5 },
    ]
  },
  "寿司": {
    category: "食物",
    strokes: [
      // 米饭 (椭圆)
      { type: "ellipse", x: 0.5, y: 0.55, rx: 0.18, ry: 0.1, color: "#FFF8DC", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.55, rx: 0.18, ry: 0.1, color: "#FFF8DC" },
      // 米饭纹理
      { type: "ellipse", x: 0.5, y: 0.55, rx: 0.16, ry: 0.08, color: "#F5F5DC", width: 1 },
      // 三文鱼 (橙色)
      { type: "ellipse", x: 0.5, y: 0.45, rx: 0.17, ry: 0.06, color: "#FF7F50", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.45, rx: 0.17, ry: 0.06, color: "#FF7F50" },
      // 三文鱼条纹
      { type: "line", x: 0.35, y: 0.45, x2: 0.65, y2: 0.45, color: "#FF6347", width: 1 },
      { type: "line", x: 0.36, y: 0.43, x2: 0.64, y2: 0.43, color: "#FF6347", width: 1 },
      { type: "line", x: 0.36, y: 0.47, x2: 0.64, y2: 0.47, color: "#FF6347", width: 1 },
      // 紫菜 (底部)
      { type: "rect", x: 0.32, y: 0.58, w: 0.36, h: 0.04, color: "#2F4F4F", width: 2 },
      { type: "fill", x: 0.32, y: 0.58, w: 0.36, h: 0.04, color: "#2F4F4F" },
      // 芥末
      { type: "ellipse", x: 0.75, y: 0.5, rx: 0.025, ry: 0.015, color: "#7CFC00", width: 1.5 },
      { type: "fill", x: 0.75, y: 0.5, rx: 0.025, ry: 0.015, color: "#7CFC00" },
      // 姜片
      { type: "ellipse", x: 0.25, y: 0.5, rx: 0.025, ry: 0.015, color: "#FFB6C1", width: 1.5 },
      { type: "fill", x: 0.25, y: 0.5, rx: 0.025, ry: 0.015, color: "#FFB6C1" },
      // 盘子
      { type: "ellipse", x: 0.5, y: 0.65, rx: 0.25, ry: 0.04, color: "#4682B4", width: 2 },
      { type: "fill", x: 0.5, y: 0.65, rx: 0.25, ry: 0.04, color: "#87CEEB" },
    ]
  },
  "冰淇淋": {
    category: "食物",
    strokes: [
      // 蛋筒
      { type: "triangle", x: 0.5, y: 0.75, w: 0.22, h: 0.22, color: "#D2691E", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.75, w: 0.22, h: 0.22, color: "#F4A460" },
      // 蛋筒网格
      { type: "line", x: 0.4, y: 0.62, x2: 0.6, y2: 0.62, color: "#D2691E", width: 1 },
      { type: "line", x: 0.42, y: 0.68, x2: 0.58, y2: 0.68, color: "#D2691E", width: 1 },
      { type: "line", x: 0.44, y: 0.74, x2: 0.56, y2: 0.74, color: "#D2691E", width: 1 },
      { type: "line", x: 0.5, y: 0.55, x2: 0.5, y2: 0.85, color: "#D2691E", width: 1 },
      // 下层冰淇淋球 (粉色)
      { type: "circle", x: 0.5, y: 0.45, r: 0.12, color: "#FF69B4", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.45, r: 0.12, color: "#FF69B4" },
      // 上层冰淇淋球 (白色)
      { type: "circle", x: 0.5, y: 0.32, r: 0.1, color: "#FFF", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.32, r: 0.1, color: "#FFF" },
      // 融化滴落
      { type: "ellipse", x: 0.42, y: 0.55, rx: 0.015, ry: 0.03, color: "#FF69B4", width: 1.5 },
      { type: "fill", x: 0.42, y: 0.55, rx: 0.015, ry: 0.03, color: "#FF69B4" },
      { type: "ellipse", x: 0.58, y: 0.55, rx: 0.015, ry: 0.03, color: "#FF69B4", width: 1.5 },
      { type: "fill", x: 0.58, y: 0.55, rx: 0.015, ry: 0.03, color: "#FF69B4" },
      // 樱桃
      { type: "circle", x: 0.5, y: 0.22, r: 0.025, color: "#DC143C", width: 2 },
      { type: "fill", x: 0.5, y: 0.22, r: 0.025, color: "#DC143C" },
      // 樱桃梗
      { type: "line", x: 0.5, y: 0.2, x2: 0.52, y2: 0.16, color: "#228B22", width: 1.5 },
    ]
  },
  "火锅": {
    category: "食物",
    strokes: [
      // 锅体
      { type: "ellipse", x: 0.5, y: 0.35, rx: 0.25, ry: 0.08, color: "#333", width: 3 },
      { type: "fill", x: 0.5, y: 0.35, rx: 0.25, ry: 0.08, color: "#555" },
      // 锅身
      { type: "rect", x: 0.25, y: 0.35, w: 0.5, h: 0.25, color: "#333", width: 3 },
      { type: "fill", x: 0.25, y: 0.35, w: 0.5, h: 0.25, color: "#555" },
      // 锅底
      { type: "arc", x: 0.5, y: 0.6, r: 0.25, start: 0, end: 3.14, color: "#333", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.25, ry: 0.08, color: "#555" },
      // 锅沿
      { type: "ellipse", x: 0.5, y: 0.35, rx: 0.26, ry: 0.04, color: "#666", width: 2.5 },
      // 汤底 (红色)
      { type: "ellipse", x: 0.5, y: 0.4, rx: 0.22, ry: 0.07, color: "#DC143C", width: 2 },
      { type: "fill", x: 0.5, y: 0.4, rx: 0.22, ry: 0.07, color: "#DC143C" },
      // 汤底 (辣油)
      { type: "ellipse", x: 0.5, y: 0.38, rx: 0.2, ry: 0.05, color: "#FF4500", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.38, rx: 0.2, ry: 0.05, color: "#FF4500" },
      // 辣椒
      { type: "ellipse", x: 0.4, y: 0.42, rx: 0.015, ry: 0.03, color: "#8B0000", width: 1.5 },
      { type: "fill", x: 0.4, y: 0.42, rx: 0.015, ry: 0.03, color: "#8B0000" },
      { type: "ellipse", x: 0.55, y: 0.44, rx: 0.015, ry: 0.03, color: "#8B0000", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.44, rx: 0.015, ry: 0.03, color: "#8B0000" },
      // 花椒
      { type: "circle", x: 0.45, y: 0.43, r: 0.008, color: "#8B4513", width: 1 },
      { type: "fill", x: 0.45, y: 0.43, r: 0.008, color: "#8B4513" },
      { type: "circle", x: 0.6, y: 0.4, r: 0.008, color: "#8B4513", width: 1 },
      { type: "fill", x: 0.6, y: 0.4, r: 0.008, color: "#8B4513" },
      // 蒸汽
      { type: "arc", x: 0.4, y: 0.25, r: 0.02, start: 0, end: 3.14, color: "#DDD", width: 1.5 },
      { type: "arc", x: 0.5, y: 0.22, r: 0.02, start: 0, end: 3.14, color: "#DDD", width: 1.5 },
      { type: "arc", x: 0.6, y: 0.25, r: 0.02, start: 0, end: 3.14, color: "#DDD", width: 1.5 },
      // 锅把手左
      { type: "rect", x: 0.18, y: 0.42, w: 0.07, h: 0.03, color: "#333", width: 2 },
      { type: "fill", x: 0.18, y: 0.42, w: 0.07, h: 0.03, color: "#555" },
      // 锅把手右
      { type: "rect", x: 0.75, y: 0.42, w: 0.07, h: 0.03, color: "#333", width: 2 },
      { type: "fill", x: 0.75, y: 0.42, w: 0.07, h: 0.03, color: "#555" },
      // 火苗
      { type: "ellipse", x: 0.5, y: 0.72, rx: 0.02, ry: 0.03, color: "#FF4500", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.72, rx: 0.02, ry: 0.03, color: "#FF4500" },
      { type: "ellipse", x: 0.45, y: 0.7, rx: 0.015, ry: 0.025, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.7, rx: 0.015, ry: 0.025, color: "#FFD700" },
      { type: "ellipse", x: 0.55, y: 0.7, rx: 0.015, ry: 0.025, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.7, rx: 0.015, ry: 0.025, color: "#FFD700" },
    ]
  },
  "包子": {
    category: "食物",
    strokes: [
      // 包子主体
      { type: "circle", x: 0.5, y: 0.5, r: 0.18, color: "#FFF8DC", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.5, r: 0.18, color: "#FFF8DC" },
      // 顶部褶皱
      { type: "arc", x: 0.5, y: 0.33, r: 0.06, start: 0, end: 3.14, color: "#F5DEB3", width: 2 },
      { type: "fill", x: 0.5, y: 0.33, rx: 0.06, ry: 0.03, color: "#F5DEB3" },
      // 褶皱线
      { type: "line", x: 0.45, y: 0.33, x2: 0.5, y2: 0.38, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.55, y: 0.33, x2: 0.5, y2: 0.38, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.5, y: 0.33, x2: 0.5, y2: 0.38, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.42, y: 0.35, x2: 0.48, y2: 0.38, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.58, y: 0.35, x2: 0.52, y2: 0.38, color: "#F5DEB3", width: 1.5 },
      // 顶部中心
      { type: "circle", x: 0.5, y: 0.33, r: 0.015, color: "#F5DEB3", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.33, r: 0.015, color: "#F5DEB3" },
      // 阴影
      { type: "arc", x: 0.5, y: 0.68, r: 0.16, start: 0, end: 3.14, color: "#DDD", width: 1.5 },
      // 蒸汽
      { type: "arc", x: 0.4, y: 0.22, r: 0.015, start: 0, end: 3.14, color: "#DDD", width: 1 },
      { type: "arc", x: 0.5, y: 0.18, r: 0.015, start: 0, end: 3.14, color: "#DDD", width: 1 },
      { type: "arc", x: 0.6, y: 0.22, r: 0.015, start: 0, end: 3.14, color: "#DDD", width: 1 },
    ]
  },
  "饺子": {
    category: "食物",
    strokes: [
      // 饺子皮 (半圆)
      { type: "arc", x: 0.5, y: 0.55, r: 0.18, start: 0, end: 3.14, color: "#FFF8DC", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.55, rx: 0.18, ry: 0.12, color: "#FFF8DC" },
      // 饺子皮底部
      { type: "arc", x: 0.5, y: 0.55, r: 0.18, start: 3.14, end: 6.28, color: "#F5DEB3", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.55, rx: 0.18, ry: 0.08, color: "#F5DEB3" },
      // 褶皱边缘
      { type: "arc", x: 0.5, y: 0.45, r: 0.17, start: 0.2, end: 2.9, color: "#F5DEB3", width: 2 },
      // 褶皱线
      { type: "line", x: 0.35, y: 0.46, x2: 0.35, y2: 0.52, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.4, y: 0.44, x2: 0.4, y2: 0.53, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.45, y: 0.43, x2: 0.45, y2: 0.54, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.5, y: 0.42, x2: 0.5, y2: 0.55, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.55, y: 0.43, x2: 0.55, y2: 0.54, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.6, y: 0.44, x2: 0.6, y2: 0.53, color: "#F5DEB3", width: 1.5 },
      { type: "line", x: 0.65, y: 0.46, x2: 0.65, y2: 0.52, color: "#F5DEB3", width: 1.5 },
      // 盘子
      { type: "ellipse", x: 0.5, y: 0.65, rx: 0.25, ry: 0.04, color: "#4682B4", width: 2 },
      { type: "fill", x: 0.5, y: 0.65, rx: 0.25, ry: 0.04, color: "#87CEEB" },
      // 蘸料
      { type: "circle", x: 0.2, y: 0.62, r: 0.02, color: "#8B0000", width: 1.5 },
      { type: "fill", x: 0.2, y: 0.62, r: 0.02, color: "#8B0000" },
    ]
  },
  "西瓜": {
    category: "食物",
    strokes: [
      // 西瓜整体 (大圆)
      { type: "circle", x: 0.5, y: 0.55, r: 0.22, color: "#228B22", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.22, color: "#228B22" },
      // 条纹
      { type: "arc", x: 0.5, y: 0.55, r: 0.21, start: 0.2, end: 0.8, color: "#006400", width: 3 },
      { type: "arc", x: 0.5, y: 0.55, r: 0.21, start: 1.2, end: 1.8, color: "#006400", width: 3 },
      { type: "arc", x: 0.5, y: 0.55, r: 0.21, start: 2.2, end: 2.8, color: "#006400", width: 3 },
      { type: "arc", x: 0.5, y: 0.55, r: 0.21, start: 3.2, end: 3.8, color: "#006400", width: 3 },
      { type: "arc", x: 0.5, y: 0.55, r: 0.21, start: 4.2, end: 4.8, color: "#006400", width: 3 },
      { type: "arc", x: 0.5, y: 0.55, r: 0.21, start: 5.2, end: 5.8, color: "#006400", width: 3 },
      // 高光
      { type: "ellipse", x: 0.42, y: 0.45, rx: 0.04, ry: 0.025, color: "#32CD32", width: 1 },
      { type: "fill", x: 0.42, y: 0.45, rx: 0.04, ry: 0.025, color: "#32CD32" },
      // 切开的西瓜 (三角形)
      { type: "triangle", x: 0.5, y: 0.75, w: 0.2, h: 0.15, color: "#FF3B3B", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.75, w: 0.2, h: 0.15, color: "#FF3B3B" },
      // 西瓜皮 (切开)
      { type: "triangle", x: 0.5, y: 0.78, w: 0.22, h: 0.05, color: "#228B22", width: 2 },
      { type: "fill", x: 0.5, y: 0.78, w: 0.22, h: 0.05, color: "#228B22" },
      // 西瓜籽
      { type: "ellipse", x: 0.45, y: 0.74, rx: 0.004, ry: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.45, y: 0.74, rx: 0.004, ry: 0.008, color: "#333" },
      { type: "ellipse", x: 0.5, y: 0.76, rx: 0.004, ry: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.5, y: 0.76, rx: 0.004, ry: 0.008, color: "#333" },
      { type: "ellipse", x: 0.55, y: 0.74, rx: 0.004, ry: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.55, y: 0.74, rx: 0.004, ry: 0.008, color: "#333" },
    ]
  },

  // ============== 物品 ==============
  "手机": {
    category: "物品",
    strokes: [
      // 手机外壳
      { type: "rect", x: 0.38, y: 0.15, w: 0.24, h: 0.7, color: "#333", width: 3 },
      { type: "fill", x: 0.38, y: 0.15, w: 0.24, h: 0.7, color: "#333" },
      // 屏幕
      { type: "rect", x: 0.4, y: 0.2, w: 0.2, h: 0.55, color: "#87CEEB", width: 2 },
      { type: "fill", x: 0.4, y: 0.2, w: 0.2, h: 0.55, color: "#B0E0E6" },
      // 屏幕内容 - 图标行
      { type: "rect", x: 0.43, y: 0.25, w: 0.04, h: 0.04, color: "#4A90D9", width: 1 },
      { type: "fill", x: 0.43, y: 0.25, w: 0.04, h: 0.04, color: "#4A90D9" },
      { type: "rect", x: 0.5, y: 0.25, w: 0.04, h: 0.04, color: "#4A90D9", width: 1 },
      { type: "fill", x: 0.5, y: 0.25, w: 0.04, h: 0.04, color: "#4A90D9" },
      { type: "rect", x: 0.57, y: 0.25, w: 0.04, h: 0.04, color: "#4A90D9", width: 1 },
      { type: "fill", x: 0.57, y: 0.25, w: 0.04, h: 0.04, color: "#4A90D9" },
      // 底部按钮
      { type: "circle", x: 0.5, y: 0.78, r: 0.015, color: "#666", width: 1.5 },
      // 听筒
      { type: "rect", x: 0.47, y: 0.18, w: 0.06, h: 0.01, color: "#555", width: 1 },
      { type: "fill", x: 0.47, y: 0.18, w: 0.06, h: 0.01, color: "#555" },
      // 摄像头
      { type: "circle", x: 0.55, y: 0.18, r: 0.005, color: "#555", width: 1 },
      { type: "fill", x: 0.55, y: 0.18, r: 0.005, color: "#555" },
    ]
  },
  "电脑": {
    category: "物品",
    strokes: [
      // 显示器屏幕
      { type: "rect", x: 0.3, y: 0.15, w: 0.4, h: 0.35, color: "#333", width: 3 },
      { type: "fill", x: 0.3, y: 0.15, w: 0.4, h: 0.35, color: "#87CEEB" },
      // 屏幕内部
      { type: "rect", x: 0.32, y: 0.17, w: 0.36, h: 0.31, color: "#B0E0E6", width: 1.5 },
      // 桌面图标
      { type: "rect", x: 0.35, y: 0.2, w: 0.02, h: 0.02, color: "#4A90D9", width: 1 },
      { type: "fill", x: 0.35, y: 0.2, w: 0.02, h: 0.02, color: "#4A90D9" },
      { type: "rect", x: 0.4, y: 0.2, w: 0.02, h: 0.02, color: "#4A90D9", width: 1 },
      { type: "fill", x: 0.4, y: 0.2, w: 0.02, h: 0.02, color: "#4A90D9" },
      // 显示器底座支架
      { type: "rect", x: 0.47, y: 0.5, w: 0.06, h: 0.1, color: "#333", width: 2.5 },
      { type: "fill", x: 0.47, y: 0.5, w: 0.06, h: 0.1, color: "#555" },
      // 显示器底座
      { type: "rect", x: 0.35, y: 0.6, w: 0.3, h: 0.04, color: "#333", width: 2.5 },
      { type: "fill", x: 0.35, y: 0.6, w: 0.3, h: 0.04, color: "#555" },
      // 键盘
      { type: "rect", x: 0.3, y: 0.68, w: 0.4, h: 0.08, color: "#333", width: 2 },
      { type: "fill", x: 0.3, y: 0.68, w: 0.4, h: 0.08, color: "#666" },
      // 键盘按键
      { type: "rect", x: 0.33, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.33, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.37, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.37, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.41, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.41, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.45, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.45, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.49, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.49, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.53, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.53, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.57, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.57, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      { type: "rect", x: 0.61, y: 0.69, w: 0.02, h: 0.02, color: "#444", width: 1 },
      { type: "fill", x: 0.61, y: 0.69, w: 0.02, h: 0.02, color: "#444" },
      // 鼠标
      { type: "ellipse", x: 0.78, y: 0.72, rx: 0.03, ry: 0.04, color: "#333", width: 2 },
      { type: "fill", x: 0.78, y: 0.72, rx: 0.03, ry: 0.04, color: "#666" },
      // 鼠标线
      { type: "line", x: 0.75, y: 0.68, x2: 0.7, y2: 0.65, color: "#333", width: 1.5 },
    ]
  },
  "台灯": {
    category: "物品",
    strokes: [
      // 灯罩
      { type: "rect", x: 0.35, y: 0.2, w: 0.3, h: 0.12, color: "#4169E1", width: 2.5 },
      { type: "fill", x: 0.35, y: 0.2, w: 0.3, h: 0.12, color: "#4169E1" },
      // 灯罩顶部
      { type: "rect", x: 0.42, y: 0.18, w: 0.16, h: 0.02, color: "#4169E1", width: 2 },
      { type: "fill", x: 0.42, y: 0.18, w: 0.16, h: 0.02, color: "#4169E1" },
      // 灯泡
      { type: "ellipse", x: 0.5, y: 0.28, rx: 0.04, ry: 0.05, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.5, y: 0.28, rx: 0.04, ry: 0.05, color: "#FFD700" },
      // 灯光 (射线)
      { type: "line", x: 0.45, y: 0.33, x2: 0.35, y2: 0.5, color: "#FFD700", width: 1 },
      { type: "line", x: 0.5, y: 0.33, x2: 0.5, y2: 0.55, color: "#FFD700", width: 1 },
      { type: "line", x: 0.55, y: 0.33, x2: 0.65, y2: 0.5, color: "#FFD700", width: 1 },
      // 灯杆
      { type: "line", x: 0.5, y: 0.32, x2: 0.5, y2: 0.65, color: "#C0C0C0", width: 2.5 },
      // 底座
      { type: "ellipse", x: 0.5, y: 0.68, rx: 0.12, ry: 0.04, color: "#C0C0C0", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.68, rx: 0.12, ry: 0.04, color: "#C0C0C0" },
      // 开关
      { type: "circle", x: 0.5, y: 0.55, r: 0.008, color: "#FF4500", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.008, color: "#FF4500" },
    ]
  },
  "雨伞": {
    category: "物品",
    strokes: [
      // 伞面 (半圆)
      { type: "arc", x: 0.5, y: 0.35, r: 0.25, start: 0, end: 3.14, color: "#FF4500", width: 3 },
      { type: "fill", x: 0.5, y: 0.35, rx: 0.25, ry: 0.15, color: "#FF6347" },
      // 伞顶
      { type: "circle", x: 0.5, y: 0.12, r: 0.008, color: "#FF4500", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.12, r: 0.008, color: "#FF4500" },
      // 伞骨
      { type: "line", x: 0.5, y: 0.35, x2: 0.3, y2: 0.35, color: "#FF4500", width: 1.5 },
      { type: "line", x: 0.5, y: 0.35, x2: 0.38, y2: 0.22, color: "#FF4500", width: 1.5 },
      { type: "line", x: 0.5, y: 0.35, x2: 0.5, y2: 0.18, color: "#FF4500", width: 1.5 },
      { type: "line", x: 0.5, y: 0.35, x2: 0.62, y2: 0.22, color: "#FF4500", width: 1.5 },
      { type: "line", x: 0.5, y: 0.35, x2: 0.7, y2: 0.35, color: "#FF4500", width: 1.5 },
      // 伞柄
      { type: "line", x: 0.5, y: 0.35, x2: 0.5, y2: 0.75, color: "#8B4513", width: 2.5 },
      // 伞柄弯钩
      { type: "arc", x: 0.5, y: 0.78, r: 0.04, start: 0, end: 3.14, color: "#8B4513", width: 2.5 },
      // 伞边装饰
      { type: "circle", x: 0.28, y: 0.35, r: 0.005, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.28, y: 0.35, r: 0.005, color: "#FFD700" },
      { type: "circle", x: 0.5, y: 0.18, r: 0.005, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.5, y: 0.18, r: 0.005, color: "#FFD700" },
      { type: "circle", x: 0.72, y: 0.35, r: 0.005, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.72, y: 0.35, r: 0.005, color: "#FFD700" },
    ]
  },
  "闹钟": {
    category: "物品",
    strokes: [
      // 钟体
      { type: "circle", x: 0.5, y: 0.45, r: 0.2, color: "#333", width: 3 },
      { type: "fill", x: 0.5, y: 0.45, r: 0.2, color: "#FFF" },
      // 钟面
      { type: "circle", x: 0.5, y: 0.45, r: 0.18, color: "#333", width: 2 },
      { type: "fill", x: 0.5, y: 0.45, r: 0.18, color: "#FFF8DC" },
      // 刻度
      { type: "line", x: 0.5, y: 0.28, x2: 0.5, y2: 0.32, color: "#333", width: 2 },
      { type: "line", x: 0.5, y: 0.62, x2: 0.5, y2: 0.58, color: "#333", width: 2 },
      { type: "line", x: 0.33, y: 0.45, x2: 0.37, y2: 0.45, color: "#333", width: 2 },
      { type: "line", x: 0.67, y: 0.45, x2: 0.63, y2: 0.45, color: "#333", width: 2 },
      // 时针
      { type: "line", x: 0.5, y: 0.45, x2: 0.45, y2: 0.35, color: "#333", width: 2.5 },
      // 分针
      { type: "line", x: 0.5, y: 0.45, x2: 0.55, y2: 0.3, color: "#333", width: 2 },
      // 中心点
      { type: "circle", x: 0.5, y: 0.45, r: 0.008, color: "#333", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.45, r: 0.008, color: "#333" },
      // 左铃铛
      { type: "arc", x: 0.38, y: 0.25, r: 0.05, start: 0, end: 3.14, color: "#FFD700", width: 2.5 },
      { type: "fill", x: 0.38, y: 0.25, rx: 0.05, ry: 0.03, color: "#FFD700" },
      // 右铃铛
      { type: "arc", x: 0.62, y: 0.25, r: 0.05, start: 0, end: 3.14, color: "#FFD700", width: 2.5 },
      { type: "fill", x: 0.62, y: 0.25, rx: 0.05, ry: 0.03, color: "#FFD700" },
      // 铃锤
      { type: "line", x: 0.5, y: 0.25, x2: 0.5, y2: 0.2, color: "#FFD700", width: 2 },
      { type: "circle", x: 0.5, y: 0.19, r: 0.006, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.19, r: 0.006, color: "#FFD700" },
      // 左腿
      { type: "rect", x: 0.38, y: 0.62, w: 0.03, h: 0.08, color: "#333", width: 2 },
      { type: "fill", x: 0.38, y: 0.62, w: 0.03, h: 0.08, color: "#333" },
      // 右腿
      { type: "rect", x: 0.59, y: 0.62, w: 0.03, h: 0.08, color: "#333", width: 2 },
      { type: "fill", x: 0.59, y: 0.62, w: 0.03, h: 0.08, color: "#333" },
    ]
  },
  "眼镜": {
    category: "物品",
    strokes: [
      // 左镜框
      { type: "circle", x: 0.38, y: 0.45, r: 0.1, color: "#333", width: 3 },
      { type: "fill", x: 0.38, y: 0.45, r: 0.1, color: "#B0E0E6" },
      // 左镜片
      { type: "circle", x: 0.38, y: 0.45, r: 0.08, color: "#87CEEB", width: 1.5 },
      { type: "fill", x: 0.38, y: 0.45, r: 0.08, color: "#B0E0E6" },
      // 右镜框
      { type: "circle", x: 0.62, y: 0.45, r: 0.1, color: "#333", width: 3 },
      { type: "fill", x: 0.62, y: 0.45, r: 0.1, color: "#B0E0E6" },
      // 右镜片
      { type: "circle", x: 0.62, y: 0.45, r: 0.08, color: "#87CEEB", width: 1.5 },
      { type: "fill", x: 0.62, y: 0.45, r: 0.08, color: "#B0E0E6" },
      // 鼻梁
      { type: "line", x: 0.48, y: 0.45, x2: 0.52, y2: 0.45, color: "#333", width: 2.5 },
      // 左镜腿
      { type: "line", x: 0.28, y: 0.43, x2: 0.12, y2: 0.38, color: "#333", width: 2 },
      { type: "line", x: 0.12, y: 0.38, x2: 0.08, y2: 0.4, color: "#333", width: 2 },
      // 右镜腿
      { type: "line", x: 0.72, y: 0.43, x2: 0.88, y2: 0.38, color: "#333", width: 2 },
      { type: "line", x: 0.88, y: 0.38, x2: 0.92, y2: 0.4, color: "#333", width: 2 },
      // 镜片反光
      { type: "line", x: 0.34, y: 0.4, x2: 0.42, y2: 0.5, color: "#FFF", width: 1.5 },
      { type: "line", x: 0.58, y: 0.4, x2: 0.66, y2: 0.5, color: "#FFF", width: 1.5 },
    ]
  },
  "背包": {
    category: "物品",
    strokes: [
      // 包体
      { type: "rect", x: 0.3, y: 0.3, w: 0.4, h: 0.45, color: "#4169E1", width: 3 },
      { type: "fill", x: 0.3, y: 0.3, w: 0.4, h: 0.45, color: "#4169E1" },
      // 包盖
      { type: "rect", x: 0.3, y: 0.3, w: 0.4, h: 0.15, color: "#3158B0", width: 2.5 },
      { type: "fill", x: 0.3, y: 0.3, w: 0.4, h: 0.15, color: "#3158B0" },
      // 包盖弧线
      { type: "arc", x: 0.5, y: 0.3, r: 0.2, start: 3.14, end: 6.28, color: "#3158B0", width: 2.5 },
      // 前袋
      { type: "rect", x: 0.35, y: 0.5, w: 0.3, h: 0.18, color: "#3158B0", width: 2 },
      { type: "fill", x: 0.35, y: 0.5, w: 0.3, h: 0.18, color: "#3158B0" },
      // 扣子
      { type: "circle", x: 0.5, y: 0.45, r: 0.01, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.45, r: 0.01, color: "#FFD700" },
      // 左肩带
      { type: "line", x: 0.35, y: 0.35, x2: 0.28, y2: 0.15, color: "#3158B0", width: 3 },
      { type: "line", x: 0.28, y: 0.15, x2: 0.35, y2: 0.3, color: "#3158B0", width: 3 },
      // 右肩带
      { type: "line", x: 0.65, y: 0.35, x2: 0.72, y2: 0.15, color: "#3158B0", width: 3 },
      { type: "line", x: 0.72, y: 0.15, x2: 0.65, y2: 0.3, color: "#3158B0", width: 3 },
      // 拉链
      { type: "line", x: 0.35, y: 0.62, x2: 0.65, y2: 0.62, color: "#FFD700", width: 1.5 },
      // 拉链头
      { type: "rect", x: 0.48, y: 0.61, w: 0.04, h: 0.015, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.48, y: 0.61, w: 0.04, h: 0.015, color: "#FFD700" },
      // 提手
      { type: "arc", x: 0.5, y: 0.28, r: 0.06, start: 0, end: 3.14, color: "#3158B0", width: 2.5 },
    ]
  },
  "杯子": {
    category: "物品",
    strokes: [
      // 杯身
      { type: "rect", x: 0.35, y: 0.3, w: 0.3, h: 0.4, color: "#4169E1", width: 2.5 },
      { type: "fill", x: 0.35, y: 0.3, w: 0.3, h: 0.4, color: "#87CEEB" },
      // 杯口
      { type: "ellipse", x: 0.5, y: 0.3, rx: 0.15, ry: 0.04, color: "#4169E1", width: 2 },
      { type: "fill", x: 0.5, y: 0.3, rx: 0.15, ry: 0.04, color: "#87CEEB" },
      // 杯底
      { type: "ellipse", x: 0.5, y: 0.7, rx: 0.15, ry: 0.04, color: "#4169E1", width: 2 },
      { type: "fill", x: 0.5, y: 0.7, rx: 0.15, ry: 0.04, color: "#87CEEB" },
      // 把手
      { type: "arc", x: 0.68, y: 0.48, r: 0.08, start: 1.5, end: 4.5, color: "#4169E1", width: 2.5 },
      // 水/饮料
      { type: "rect", x: 0.37, y: 0.45, w: 0.26, h: 0.25, color: "#B0E0E6", width: 1.5 },
      { type: "fill", x: 0.37, y: 0.45, w: 0.26, h: 0.25, color: "#B0E0E6" },
      // 水面
      { type: "ellipse", x: 0.5, y: 0.45, rx: 0.13, ry: 0.03, color: "#87CEEB", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.45, rx: 0.13, ry: 0.03, color: "#87CEEB" },
      // 气泡
      { type: "circle", x: 0.42, y: 0.55, r: 0.008, color: "#FFF", width: 1 },
      { type: "circle", x: 0.55, y: 0.6, r: 0.006, color: "#FFF", width: 1 },
    ]
  },
  "吉他": {
    category: "物品",
    strokes: [
      // 琴身 (葫芦形)
      { type: "circle", x: 0.5, y: 0.65, r: 0.15, color: "#D2691E", width: 3 },
      { type: "fill", x: 0.5, y: 0.65, r: 0.15, color: "#DEB887" },
      // 琴身下部分
      { type: "circle", x: 0.5, y: 0.5, r: 0.12, color: "#D2691E", width: 3 },
      { type: "fill", x: 0.5, y: 0.5, r: 0.12, color: "#DEB887" },
      // 琴颈
      { type: "rect", x: 0.48, y: 0.15, w: 0.04, h: 0.35, color: "#8B4513", width: 2.5 },
      { type: "fill", x: 0.48, y: 0.15, w: 0.04, h: 0.35, color: "#8B4513" },
      // 琴头
      { type: "rect", x: 0.47, y: 0.08, w: 0.06, h: 0.08, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.47, y: 0.08, w: 0.06, h: 0.08, color: "#8B4513" },
      // 音孔
      { type: "circle", x: 0.5, y: 0.58, r: 0.04, color: "#333", width: 2 },
      { type: "fill", x: 0.5, y: 0.58, r: 0.04, color: "#333" },
      // 琴弦
      { type: "line", x: 0.49, y: 0.12, x2: 0.49, y2: 0.5, color: "#C0C0C0", width: 1 },
      { type: "line", x: 0.5, y: 0.12, x2: 0.5, y2: 0.5, color: "#C0C0C0", width: 1 },
      { type: "line", x: 0.51, y: 0.12, x2: 0.51, y2: 0.5, color: "#C0C0C0", width: 1 },
      // 琴桥
      { type: "rect", x: 0.47, y: 0.5, w: 0.06, h: 0.01, color: "#333", width: 1.5 },
      { type: "fill", x: 0.47, y: 0.5, w: 0.06, h: 0.01, color: "#333" },
      // 品丝
      { type: "line", x: 0.48, y: 0.25, x2: 0.52, y2: 0.25, color: "#C0C0C0", width: 1 },
      { type: "line", x: 0.48, y: 0.32, x2: 0.52, y2: 0.32, color: "#C0C0C0", width: 1 },
      { type: "line", x: 0.48, y: 0.39, x2: 0.52, y2: 0.39, color: "#C0C0C0", width: 1 },
      // 琴头旋钮
      { type: "circle", x: 0.465, y: 0.09, r: 0.004, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.465, y: 0.09, r: 0.004, color: "#FFD700" },
      { type: "circle", x: 0.5, y: 0.08, r: 0.004, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.5, y: 0.08, r: 0.004, color: "#FFD700" },
      { type: "circle", x: 0.535, y: 0.09, r: 0.004, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.535, y: 0.09, r: 0.004, color: "#FFD700" },
    ]
  },
  "钢琴": {
    category: "物品",
    strokes: [
      // 钢琴主体
      { type: "rect", x: 0.2, y: 0.35, w: 0.6, h: 0.35, color: "#333", width: 3 },
      { type: "fill", x: 0.2, y: 0.35, w: 0.6, h: 0.35, color: "#333" },
      // 钢琴面板
      { type: "rect", x: 0.22, y: 0.37, w: 0.56, h: 0.3, color: "#FFF", width: 2 },
      { type: "fill", x: 0.22, y: 0.37, w: 0.56, h: 0.3, color: "#FFF" },
      // 白键
      { type: "rect", x: 0.24, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.24, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.285, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.285, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.33, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.33, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.375, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.375, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.42, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.42, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.465, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.465, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.51, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.51, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.555, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.555, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.6, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.6, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.645, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.645, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.69, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.69, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      { type: "rect", x: 0.735, y: 0.42, w: 0.035, h: 0.23, color: "#333", width: 1.5 },
      { type: "fill", x: 0.735, y: 0.42, w: 0.035, h: 0.23, color: "#FFF" },
      // 黑键
      { type: "rect", x: 0.27, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.27, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.315, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.315, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.405, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.405, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.45, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.495, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.54, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.54, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.585, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.585, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.675, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.675, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
      { type: "rect", x: 0.72, y: 0.42, w: 0.022, h: 0.13, color: "#333", width: 1 },
      { type: "fill", x: 0.72, y: 0.42, w: 0.022, h: 0.13, color: "#333" },
    ]
  },

  // ============== 风景 ==============
  "山": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.5, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.5, color: "#87CEEB" },
      // 左山
      { type: "triangle", x: 0.3, y: 0.55, w: 0.5, h: 0.5, color: "#556B2F", width: 3 },
      { type: "fill", x: 0.3, y: 0.55, w: 0.5, h: 0.5, color: "#6B8E23" },
      // 右山
      { type: "triangle", x: 0.7, y: 0.55, w: 0.5, h: 0.45, color: "#556B2F", width: 3 },
      { type: "fill", x: 0.7, y: 0.55, w: 0.5, h: 0.45, color: "#6B8E23" },
      // 雪山山顶左
      { type: "triangle", x: 0.3, y: 0.3, w: 0.15, h: 0.15, color: "#FFF", width: 2 },
      { type: "fill", x: 0.3, y: 0.3, w: 0.15, h: 0.15, color: "#FFF" },
      // 雪山山顶右
      { type: "triangle", x: 0.7, y: 0.32, w: 0.12, h: 0.12, color: "#FFF", width: 2 },
      { type: "fill", x: 0.7, y: 0.32, w: 0.12, h: 0.12, color: "#FFF" },
      // 中间小山峰
      { type: "triangle", x: 0.5, y: 0.55, w: 0.25, h: 0.35, color: "#556B2F", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.55, w: 0.25, h: 0.35, color: "#6B8E23" },
      // 地面
      { type: "rect", x: 0, y: 0.6, w: 1, h: 0.4, color: "#228B22", width: 2 },
      { type: "fill", x: 0, y: 0.6, w: 1, h: 0.4, color: "#228B22" },
      // 太阳
      { type: "circle", x: 0.85, y: 0.15, r: 0.06, color: "#FFD700", width: 2.5 },
      { type: "fill", x: 0.85, y: 0.15, r: 0.06, color: "#FFD700" },
      // 云
      { type: "circle", x: 0.2, y: 0.15, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.2, y: 0.15, r: 0.04, color: "#FFF" },
      { type: "circle", x: 0.25, y: 0.14, r: 0.05, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.25, y: 0.14, r: 0.05, color: "#FFF" },
      { type: "circle", x: 0.3, y: 0.15, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.3, y: 0.15, r: 0.04, color: "#FFF" },
    ]
  },
  "大海": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.45, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.45, color: "#87CEEB" },
      // 大海
      { type: "rect", x: 0, y: 0.45, w: 1, h: 0.55, color: "#1E90FF", width: 2 },
      { type: "fill", x: 0, y: 0.45, w: 1, h: 0.55, color: "#1E90FF" },
      // 海面波浪
      { type: "arc", x: 0.1, y: 0.45, r: 0.03, start: 0, end: 3.14, color: "#FFF", width: 2 },
      { type: "arc", x: 0.3, y: 0.45, r: 0.03, start: 0, end: 3.14, color: "#FFF", width: 2 },
      { type: "arc", x: 0.5, y: 0.45, r: 0.03, start: 0, end: 3.14, color: "#FFF", width: 2 },
      { type: "arc", x: 0.7, y: 0.45, r: 0.03, start: 0, end: 3.14, color: "#FFF", width: 2 },
      { type: "arc", x: 0.9, y: 0.45, r: 0.03, start: 0, end: 3.14, color: "#FFF", width: 2 },
      // 波浪线
      { type: "arc", x: 0.2, y: 0.55, r: 0.02, start: 0, end: 3.14, color: "#FFF", width: 1.5 },
      { type: "arc", x: 0.4, y: 0.55, r: 0.02, start: 0, end: 3.14, color: "#FFF", width: 1.5 },
      { type: "arc", x: 0.6, y: 0.55, r: 0.02, start: 0, end: 3.14, color: "#FFF", width: 1.5 },
      { type: "arc", x: 0.8, y: 0.55, r: 0.02, start: 0, end: 3.14, color: "#FFF", width: 1.5 },
      // 太阳
      { type: "circle", x: 0.8, y: 0.2, r: 0.06, color: "#FFD700", width: 2.5 },
      { type: "fill", x: 0.8, y: 0.2, r: 0.06, color: "#FFD700" },
      // 太阳光
      { type: "line", x: 0.8, y: 0.12, x2: 0.8, y2: 0.08, color: "#FFD700", width: 1.5 },
      { type: "line", x: 0.88, y: 0.14, x2: 0.92, y2: 0.1, color: "#FFD700", width: 1.5 },
      { type: "line", x: 0.72, y: 0.14, x2: 0.68, y2: 0.1, color: "#FFD700", width: 1.5 },
      // 云
      { type: "circle", x: 0.2, y: 0.15, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.2, y: 0.15, r: 0.04, color: "#FFF" },
      { type: "circle", x: 0.25, y: 0.13, r: 0.05, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.25, y: 0.13, r: 0.05, color: "#FFF" },
      { type: "circle", x: 0.3, y: 0.15, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.3, y: 0.15, r: 0.04, color: "#FFF" },
      // 海鸥
      { type: "arc", x: 0.5, y: 0.25, r: 0.02, start: 0, end: 3.14, color: "#333", width: 1.5 },
      { type: "arc", x: 0.55, y: 0.25, r: 0.02, start: 3.14, end: 6.28, color: "#333", width: 1.5 },
    ]
  },
  "日落": {
    category: "风景",
    strokes: [
      // 天空渐变 - 顶部深蓝
      { type: "rect", x: 0, y: 0, w: 1, h: 0.3, color: "#4A90D9", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.3, color: "#4A90D9" },
      // 天空渐变 - 中部橙色
      { type: "rect", x: 0, y: 0.3, w: 1, h: 0.2, color: "#FF8C00", width: 1 },
      { type: "fill", x: 0, y: 0.3, w: 1, h: 0.2, color: "#FF8C00" },
      // 天空渐变 - 下部红色
      { type: "rect", x: 0, y: 0.5, w: 1, h: 0.15, color: "#DC143C", width: 1 },
      { type: "fill", x: 0, y: 0.5, w: 1, h: 0.15, color: "#DC143C" },
      // 太阳
      { type: "circle", x: 0.5, y: 0.55, r: 0.1, color: "#FF4500", width: 3 },
      { type: "fill", x: 0.5, y: 0.55, r: 0.1, color: "#FF4500" },
      // 太阳光晕
      { type: "circle", x: 0.5, y: 0.55, r: 0.14, color: "#FFD700", width: 2 },
      // 地面/海面
      { type: "rect", x: 0, y: 0.65, w: 1, h: 0.35, color: "#2F4F4F", width: 2 },
      { type: "fill", x: 0, y: 0.65, w: 1, h: 0.35, color: "#2F4F4F" },
      // 水面倒影
      { type: "line", x: 0.45, y: 0.68, x2: 0.55, y2: 0.68, color: "#FFD700", width: 2 },
      { type: "line", x: 0.42, y: 0.73, x2: 0.58, y2: 0.73, color: "#FFD700", width: 1.5 },
      { type: "line", x: 0.44, y: 0.78, x2: 0.56, y2: 0.78, color: "#FFD700", width: 1.5 },
      // 云彩
      { type: "ellipse", x: 0.25, y: 0.35, rx: 0.06, ry: 0.02, color: "#FF69B4", width: 1.5 },
      { type: "fill", x: 0.25, y: 0.35, rx: 0.06, ry: 0.02, color: "#FF69B4" },
      { type: "ellipse", x: 0.75, y: 0.32, rx: 0.05, ry: 0.02, color: "#FF69B4", width: 1.5 },
      { type: "fill", x: 0.75, y: 0.32, rx: 0.05, ry: 0.02, color: "#FF69B4" },
      // 飞鸟
      { type: "arc", x: 0.3, y: 0.2, r: 0.015, start: 0, end: 3.14, color: "#333", width: 1.5 },
      { type: "arc", x: 0.33, y: 0.2, r: 0.015, start: 3.14, end: 6.28, color: "#333", width: 1.5 },
      { type: "arc", x: 0.7, y: 0.18, r: 0.015, start: 0, end: 3.14, color: "#333", width: 1.5 },
      { type: "arc", x: 0.73, y: 0.18, r: 0.015, start: 3.14, end: 6.28, color: "#333", width: 1.5 },
    ]
  },
  "星空": {
    category: "风景",
    strokes: [
      // 夜空
      { type: "rect", x: 0, y: 0, w: 1, h: 1, color: "#0B0B2B", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 1, color: "#0B0B2B" },
      // 月亮 (弯月)
      { type: "circle", x: 0.75, y: 0.2, r: 0.06, color: "#FFF8DC", width: 2.5 },
      { type: "fill", x: 0.75, y: 0.2, r: 0.06, color: "#FFF8DC" },
      { type: "circle", x: 0.78, y: 0.18, r: 0.05, color: "#0B0B2B", width: 1 },
      { type: "fill", x: 0.78, y: 0.18, r: 0.05, color: "#0B0B2B" },
      // 星星 - 大
      { type: "circle", x: 0.2, y: 0.15, r: 0.015, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.2, y: 0.15, r: 0.015, color: "#FFF" },
      { type: "circle", x: 0.5, y: 0.1, r: 0.012, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.1, r: 0.012, color: "#FFF" },
      { type: "circle", x: 0.35, y: 0.3, r: 0.015, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.35, y: 0.3, r: 0.015, color: "#FFF" },
      // 星星 - 中
      { type: "circle", x: 0.1, y: 0.35, r: 0.01, color: "#FFF", width: 1 },
      { type: "fill", x: 0.1, y: 0.35, r: 0.01, color: "#FFF" },
      { type: "circle", x: 0.65, y: 0.15, r: 0.01, color: "#FFF", width: 1 },
      { type: "fill", x: 0.65, y: 0.15, r: 0.01, color: "#FFF" },
      { type: "circle", x: 0.85, y: 0.35, r: 0.01, color: "#FFF", width: 1 },
      { type: "fill", x: 0.85, y: 0.35, r: 0.01, color: "#FFF" },
      { type: "circle", x: 0.15, y: 0.5, r: 0.01, color: "#FFF", width: 1 },
      { type: "fill", x: 0.15, y: 0.5, r: 0.01, color: "#FFF" },
      // 星星 - 小
      { type: "circle", x: 0.3, y: 0.2, r: 0.006, color: "#FFF", width: 1 },
      { type: "fill", x: 0.3, y: 0.2, r: 0.006, color: "#FFF" },
      { type: "circle", x: 0.45, y: 0.25, r: 0.006, color: "#FFF", width: 1 },
      { type: "fill", x: 0.45, y: 0.25, r: 0.006, color: "#FFF" },
      { type: "circle", x: 0.55, y: 0.35, r: 0.006, color: "#FFF", width: 1 },
      { type: "fill", x: 0.55, y: 0.35, r: 0.006, color: "#FFF" },
      { type: "circle", x: 0.7, y: 0.3, r: 0.006, color: "#FFF", width: 1 },
      { type: "fill", x: 0.7, y: 0.3, r: 0.006, color: "#FFF" },
      { type: "circle", x: 0.9, y: 0.2, r: 0.006, color: "#FFF", width: 1 },
      { type: "fill", x: 0.9, y: 0.2, r: 0.006, color: "#FFF" },
      { type: "circle", x: 0.08, y: 0.2, r: 0.006, color: "#FFF", width: 1 },
      { type: "fill", x: 0.08, y: 0.2, r: 0.006, color: "#FFF" },
      // 银河
      { type: "ellipse", x: 0.5, y: 0.5, rx: 0.4, ry: 0.08, color: "#1A1A4A", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.5, rx: 0.4, ry: 0.08, color: "#1A1A4A" },
      // 流星
      { type: "line", x: 0.8, y: 0.1, x2: 0.7, y2: 0.2, color: "#FFF", width: 1.5 },
    ]
  },
  "森林": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.3, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.3, color: "#87CEEB" },
      // 地面
      { type: "rect", x: 0, y: 0.65, w: 1, h: 0.35, color: "#228B22", width: 2 },
      { type: "fill", x: 0, y: 0.65, w: 1, h: 0.35, color: "#228B22" },
      // 树1 - 树干
      { type: "rect", x: 0.15, y: 0.35, w: 0.04, h: 0.3, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.15, y: 0.35, w: 0.04, h: 0.3, color: "#8B4513" },
      // 树1 - 树冠
      { type: "triangle", x: 0.17, y: 0.35, w: 0.2, h: 0.25, color: "#228B22", width: 2.5 },
      { type: "fill", x: 0.17, y: 0.35, w: 0.2, h: 0.25, color: "#228B22" },
      // 树2 - 树干
      { type: "rect", x: 0.38, y: 0.3, w: 0.04, h: 0.35, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.38, y: 0.3, w: 0.04, h: 0.35, color: "#8B4513" },
      // 树2 - 树冠
      { type: "triangle", x: 0.4, y: 0.3, w: 0.22, h: 0.28, color: "#006400", width: 2.5 },
      { type: "fill", x: 0.4, y: 0.3, w: 0.22, h: 0.28, color: "#006400" },
      // 树3 - 树干
      { type: "rect", x: 0.6, y: 0.32, w: 0.04, h: 0.33, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.6, y: 0.32, w: 0.04, h: 0.33, color: "#8B4513" },
      // 树3 - 树冠
      { type: "triangle", x: 0.62, y: 0.32, w: 0.2, h: 0.26, color: "#228B22", width: 2.5 },
      { type: "fill", x: 0.62, y: 0.32, w: 0.2, h: 0.26, color: "#228B22" },
      // 树4 - 树干
      { type: "rect", x: 0.82, y: 0.38, w: 0.04, h: 0.27, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.82, y: 0.38, w: 0.04, h: 0.27, color: "#8B4513" },
      // 树4 - 树冠
      { type: "triangle", x: 0.84, y: 0.38, w: 0.18, h: 0.22, color: "#006400", width: 2.5 },
      { type: "fill", x: 0.84, y: 0.38, w: 0.18, h: 0.22, color: "#006400" },
      // 太阳
      { type: "circle", x: 0.85, y: 0.1, r: 0.04, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.85, y: 0.1, r: 0.04, color: "#FFD700" },
      // 小草
      { type: "line", x: 0.1, y: 0.65, x2: 0.1, y2: 0.6, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.3, y: 0.65, x2: 0.3, y2: 0.6, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.5, y: 0.65, x2: 0.5, y2: 0.61, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.7, y: 0.65, x2: 0.7, y2: 0.6, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.95, y: 0.65, x2: 0.95, y2: 0.61, color: "#32CD32", width: 1.5 },
    ]
  },
  "瀑布": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.2, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.2, color: "#87CEEB" },
      // 左山崖
      { type: "rect", x: 0, y: 0.2, w: 0.35, h: 0.7, color: "#556B2F", width: 2.5 },
      { type: "fill", x: 0, y: 0.2, w: 0.35, h: 0.7, color: "#6B8E23" },
      // 右山崖
      { type: "rect", x: 0.65, y: 0.2, w: 0.35, h: 0.7, color: "#556B2F", width: 2.5 },
      { type: "fill", x: 0.65, y: 0.2, w: 0.35, h: 0.7, color: "#6B8E23" },
      // 瀑布水流
      { type: "rect", x: 0.35, y: 0.2, w: 0.3, h: 0.6, color: "#B0E0E6", width: 2 },
      { type: "fill", x: 0.35, y: 0.2, w: 0.3, h: 0.6, color: "#B0E0E6" },
      // 水流线条
      { type: "line", x: 0.4, y: 0.2, x2: 0.38, y2: 0.8, color: "#FFF", width: 1.5 },
      { type: "line", x: 0.5, y: 0.2, x2: 0.5, y2: 0.8, color: "#FFF", width: 1.5 },
      { type: "line", x: 0.6, y: 0.2, x2: 0.62, y2: 0.8, color: "#FFF", width: 1.5 },
      // 水花 (底部)
      { type: "ellipse", x: 0.5, y: 0.8, rx: 0.25, ry: 0.05, color: "#B0E0E6", width: 2 },
      { type: "fill", x: 0.5, y: 0.8, rx: 0.25, ry: 0.05, color: "#B0E0E6" },
      // 水花溅起
      { type: "circle", x: 0.35, y: 0.78, r: 0.015, color: "#FFF", width: 1 },
      { type: "circle", x: 0.65, y: 0.78, r: 0.015, color: "#FFF", width: 1 },
      // 山顶树木
      { type: "triangle", x: 0.15, y: 0.22, w: 0.15, h: 0.15, color: "#228B22", width: 2 },
      { type: "fill", x: 0.15, y: 0.22, w: 0.15, h: 0.15, color: "#228B22" },
      { type: "triangle", x: 0.85, y: 0.22, w: 0.15, h: 0.15, color: "#228B22", width: 2 },
      { type: "fill", x: 0.85, y: 0.22, w: 0.15, h: 0.15, color: "#228B22" },
      // 水潭
      { type: "ellipse", x: 0.5, y: 0.88, rx: 0.3, ry: 0.06, color: "#4682B4", width: 2 },
      { type: "fill", x: 0.5, y: 0.88, rx: 0.3, ry: 0.06, color: "#4682B4" },
    ]
  },
  "沙漠": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.35, color: "#FFD700", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.35, color: "#FFD700" },
      // 远处沙丘
      { type: "arc", x: 0.5, y: 0.35, r: 0.3, start: 0, end: 3.14, color: "#EDC9AF", width: 2 },
      { type: "fill", x: 0.5, y: 0.35, rx: 0.5, ry: 0.15, color: "#EDC9AF" },
      // 近处沙丘
      { type: "arc", x: 0.3, y: 0.55, r: 0.35, start: 0, end: 3.14, color: "#D2B48C", width: 2 },
      { type: "fill", x: 0.3, y: 0.55, rx: 0.5, ry: 0.15, color: "#D2B48C" },
      // 近处沙丘2
      { type: "arc", x: 0.7, y: 0.6, r: 0.3, start: 0, end: 3.14, color: "#DEB887", width: 2 },
      { type: "fill", x: 0.7, y: 0.6, rx: 0.4, ry: 0.12, color: "#DEB887" },
      // 沙丘纹理
      { type: "arc", x: 0.3, y: 0.45, r: 0.15, start: 0, end: 3.14, color: "#C4A882", width: 1.5 },
      { type: "arc", x: 0.7, y: 0.5, r: 0.12, start: 0, end: 3.14, color: "#C4A882", width: 1.5 },
      // 太阳
      { type: "circle", x: 0.8, y: 0.1, r: 0.06, color: "#FF4500", width: 2.5 },
      { type: "fill", x: 0.8, y: 0.1, r: 0.06, color: "#FF4500" },
      // 仙人掌
      { type: "rect", x: 0.2, y: 0.4, w: 0.03, h: 0.15, color: "#228B22", width: 2 },
      { type: "fill", x: 0.2, y: 0.4, w: 0.03, h: 0.15, color: "#228B22" },
      // 仙人掌左臂
      { type: "line", x: 0.2, y: 0.47, x2: 0.15, y2: 0.44, color: "#228B22", width: 2.5 },
      { type: "line", x: 0.15, y: 0.44, x2: 0.15, y2: 0.48, color: "#228B22", width: 2.5 },
      // 仙人掌右臂
      { type: "line", x: 0.23, y: 0.45, x2: 0.27, y2: 0.42, color: "#228B22", width: 2.5 },
      { type: "line", x: 0.27, y: 0.42, x2: 0.27, y2: 0.46, color: "#228B22", width: 2.5 },
      // 仙人掌2
      { type: "rect", x: 0.75, y: 0.5, w: 0.025, h: 0.12, color: "#228B22", width: 2 },
      { type: "fill", x: 0.75, y: 0.5, w: 0.025, h: 0.12, color: "#228B22" },
    ]
  },
  "彩虹": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.5, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.5, color: "#87CEEB" },
      // 地面
      { type: "rect", x: 0, y: 0.5, w: 1, h: 0.5, color: "#228B22", width: 2 },
      { type: "fill", x: 0, y: 0.5, w: 1, h: 0.5, color: "#228B22" },
      // 彩虹弧 - 红
      { type: "arc", x: 0.5, y: 0.55, r: 0.35, start: 3.14, end: 6.28, color: "#FF0000", width: 4 },
      // 彩虹弧 - 橙
      { type: "arc", x: 0.5, y: 0.55, r: 0.31, start: 3.14, end: 6.28, color: "#FF7F00", width: 4 },
      // 彩虹弧 - 黄
      { type: "arc", x: 0.5, y: 0.55, r: 0.27, start: 3.14, end: 6.28, color: "#FFFF00", width: 4 },
      // 彩虹弧 - 绿
      { type: "arc", x: 0.5, y: 0.55, r: 0.23, start: 3.14, end: 6.28, color: "#00FF00", width: 4 },
      // 彩虹弧 - 青
      { type: "arc", x: 0.5, y: 0.55, r: 0.19, start: 3.14, end: 6.28, color: "#00FFFF", width: 4 },
      // 彩虹弧 - 蓝
      { type: "arc", x: 0.5, y: 0.55, r: 0.15, start: 3.14, end: 6.28, color: "#0000FF", width: 4 },
      // 彩虹弧 - 紫
      { type: "arc", x: 0.5, y: 0.55, r: 0.11, start: 3.14, end: 6.28, color: "#8B00FF", width: 4 },
      // 云左
      { type: "circle", x: 0.2, y: 0.35, r: 0.05, color: "#FFF", width: 2 },
      { type: "fill", x: 0.2, y: 0.35, r: 0.05, color: "#FFF" },
      { type: "circle", x: 0.25, y: 0.33, r: 0.06, color: "#FFF", width: 2 },
      { type: "fill", x: 0.25, y: 0.33, r: 0.06, color: "#FFF" },
      { type: "circle", x: 0.3, y: 0.35, r: 0.05, color: "#FFF", width: 2 },
      { type: "fill", x: 0.3, y: 0.35, r: 0.05, color: "#FFF" },
      // 云右
      { type: "circle", x: 0.7, y: 0.35, r: 0.05, color: "#FFF", width: 2 },
      { type: "fill", x: 0.7, y: 0.35, r: 0.05, color: "#FFF" },
      { type: "circle", x: 0.75, y: 0.33, r: 0.06, color: "#FFF", width: 2 },
      { type: "fill", x: 0.75, y: 0.33, r: 0.06, color: "#FFF" },
      { type: "circle", x: 0.8, y: 0.35, r: 0.05, color: "#FFF", width: 2 },
      { type: "fill", x: 0.8, y: 0.35, r: 0.05, color: "#FFF" },
      // 太阳
      { type: "circle", x: 0.85, y: 0.15, r: 0.04, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.85, y: 0.15, r: 0.04, color: "#FFD700" },
      // 花朵
      { type: "circle", x: 0.4, y: 0.7, r: 0.008, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.4, y: 0.7, r: 0.008, color: "#FF1493" },
      { type: "circle", x: 0.6, y: 0.65, r: 0.008, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.6, y: 0.65, r: 0.008, color: "#FF1493" },
    ]
  },
  "雪地": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.4, color: "#B0C4DE", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.4, color: "#B0C4DE" },
      // 雪地
      { type: "rect", x: 0, y: 0.4, w: 1, h: 0.6, color: "#FFF", width: 2 },
      { type: "fill", x: 0, y: 0.4, w: 1, h: 0.6, color: "#FFF" },
      // 雪地起伏
      { type: "arc", x: 0.3, y: 0.4, r: 0.1, start: 0, end: 3.14, color: "#F0F0F0", width: 2 },
      { type: "fill", x: 0.3, y: 0.4, rx: 0.15, ry: 0.04, color: "#F0F0F0" },
      { type: "arc", x: 0.7, y: 0.4, r: 0.12, start: 0, end: 3.14, color: "#F0F0F0", width: 2 },
      { type: "fill", x: 0.7, y: 0.4, rx: 0.18, ry: 0.05, color: "#F0F0F0" },
      // 雪人 - 下身
      { type: "circle", x: 0.5, y: 0.65, r: 0.1, color: "#E8E8E8", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.65, r: 0.1, color: "#FFF" },
      // 雪人 - 上身
      { type: "circle", x: 0.5, y: 0.5, r: 0.08, color: "#E8E8E8", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.5, r: 0.08, color: "#FFF" },
      // 雪人 - 头部
      { type: "circle", x: 0.5, y: 0.36, r: 0.06, color: "#E8E8E8", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.36, r: 0.06, color: "#FFF" },
      // 眼睛
      { type: "circle", x: 0.48, y: 0.35, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.48, y: 0.35, r: 0.008, color: "#333" },
      { type: "circle", x: 0.52, y: 0.35, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.52, y: 0.35, r: 0.008, color: "#333" },
      // 鼻子 (胡萝卜)
      { type: "triangle", x: 0.5, y: 0.38, w: 0.04, h: 0.025, color: "#FF8C00", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.38, w: 0.04, h: 0.025, color: "#FF8C00" },
      // 帽子
      { type: "rect", x: 0.47, y: 0.28, w: 0.06, h: 0.05, color: "#333", width: 2 },
      { type: "fill", x: 0.47, y: 0.28, w: 0.06, h: 0.05, color: "#333" },
      { type: "rect", x: 0.45, y: 0.33, w: 0.1, h: 0.015, color: "#333", width: 2 },
      { type: "fill", x: 0.45, y: 0.33, w: 0.1, h: 0.015, color: "#333" },
      // 围巾
      { type: "rect", x: 0.45, y: 0.42, w: 0.1, h: 0.02, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.42, w: 0.1, h: 0.02, color: "#FF0000" },
      // 纽扣
      { type: "circle", x: 0.5, y: 0.48, r: 0.005, color: "#333", width: 1 },
      { type: "fill", x: 0.5, y: 0.48, r: 0.005, color: "#333" },
      { type: "circle", x: 0.5, y: 0.53, r: 0.005, color: "#333", width: 1 },
      { type: "fill", x: 0.5, y: 0.53, r: 0.005, color: "#333" },
      // 树
      { type: "rect", x: 0.2, y: 0.45, w: 0.03, h: 0.15, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.2, y: 0.45, w: 0.03, h: 0.15, color: "#8B4513" },
      { type: "triangle", x: 0.215, y: 0.45, w: 0.12, h: 0.15, color: "#006400", width: 2 },
      { type: "fill", x: 0.215, y: 0.45, w: 0.12, h: 0.15, color: "#006400" },
      // 雪花
      { type: "circle", x: 0.15, y: 0.2, r: 0.004, color: "#FFF", width: 1 },
      { type: "circle", x: 0.35, y: 0.15, r: 0.004, color: "#FFF", width: 1 },
      { type: "circle", x: 0.65, y: 0.18, r: 0.004, color: "#FFF", width: 1 },
      { type: "circle", x: 0.85, y: 0.22, r: 0.004, color: "#FFF", width: 1 },
      { type: "circle", x: 0.5, y: 0.12, r: 0.004, color: "#FFF", width: 1 },
    ]
  },
  "草原": {
    category: "风景",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 0.35, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 0.35, color: "#87CEEB" },
      // 远山
      { type: "arc", x: 0.5, y: 0.35, r: 0.3, start: 0, end: 3.14, color: "#6B8E23", width: 2 },
      { type: "fill", x: 0.5, y: 0.35, rx: 0.5, ry: 0.1, color: "#6B8E23" },
      // 草地
      { type: "rect", x: 0, y: 0.45, w: 1, h: 0.55, color: "#32CD32", width: 2 },
      { type: "fill", x: 0, y: 0.45, w: 1, h: 0.55, color: "#32CD32" },
      // 草地纹理
      { type: "rect", x: 0, y: 0.5, w: 1, h: 0.5, color: "#228B22", width: 1.5 },
      { type: "fill", x: 0, y: 0.5, w: 1, h: 0.5, color: "#228B22" },
      // 小草
      { type: "line", x: 0.1, y: 0.5, x2: 0.1, y2: 0.44, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.15, y: 0.5, x2: 0.15, y2: 0.45, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.3, y: 0.5, x2: 0.3, y2: 0.44, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.45, y: 0.5, x2: 0.45, y2: 0.45, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.6, y: 0.5, x2: 0.6, y2: 0.44, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.75, y: 0.5, x2: 0.75, y2: 0.45, color: "#32CD32", width: 1.5 },
      { type: "line", x: 0.9, y: 0.5, x2: 0.9, y2: 0.44, color: "#32CD32", width: 1.5 },
      // 花
      { type: "circle", x: 0.2, y: 0.48, r: 0.006, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.2, y: 0.48, r: 0.006, color: "#FF1493" },
      { type: "circle", x: 0.5, y: 0.47, r: 0.006, color: "#FFD700", width: 1 },
      { type: "fill", x: 0.5, y: 0.47, r: 0.006, color: "#FFD700" },
      { type: "circle", x: 0.8, y: 0.48, r: 0.006, color: "#FF1493", width: 1 },
      { type: "fill", x: 0.8, y: 0.48, r: 0.006, color: "#FF1493" },
      // 太阳
      { type: "circle", x: 0.85, y: 0.1, r: 0.05, color: "#FFD700", width: 2.5 },
      { type: "fill", x: 0.85, y: 0.1, r: 0.05, color: "#FFD700" },
      // 云
      { type: "circle", x: 0.2, y: 0.12, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.2, y: 0.12, r: 0.04, color: "#FFF" },
      { type: "circle", x: 0.25, y: 0.1, r: 0.05, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.25, y: 0.1, r: 0.05, color: "#FFF" },
      { type: "circle", x: 0.3, y: 0.12, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.3, y: 0.12, r: 0.04, color: "#FFF" },
      // 蝴蝶
      { type: "ellipse", x: 0.65, y: 0.35, rx: 0.008, ry: 0.005, color: "#FF69B4", width: 1 },
      { type: "fill", x: 0.65, y: 0.35, rx: 0.008, ry: 0.005, color: "#FF69B4" },
      { type: "ellipse", x: 0.66, y: 0.35, rx: 0.008, ry: 0.005, color: "#FF69B4", width: 1 },
      { type: "fill", x: 0.66, y: 0.35, rx: 0.008, ry: 0.005, color: "#FF69B4" },
    ]
  },

  // ============== 动漫 ==============
  "龙猫": {
    category: "动漫",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.22, ry: 0.25, color: "#808080", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.22, ry: 0.25, color: "#808080" },
      // 肚子 (浅色)
      { type: "ellipse", x: 0.5, y: 0.65, rx: 0.15, ry: 0.16, color: "#D3D3D3", width: 2 },
      { type: "fill", x: 0.5, y: 0.65, rx: 0.15, ry: 0.16, color: "#D3D3D3" },
      // 左耳
      { type: "triangle", x: 0.38, y: 0.3, w: 0.08, h: 0.12, color: "#808080", width: 2 },
      { type: "fill", x: 0.38, y: 0.3, w: 0.08, h: 0.12, color: "#808080" },
      // 右耳
      { type: "triangle", x: 0.62, y: 0.3, w: 0.08, h: 0.12, color: "#808080", width: 2 },
      { type: "fill", x: 0.62, y: 0.3, w: 0.08, h: 0.12, color: "#808080" },
      // 头部
      { type: "circle", x: 0.5, y: 0.38, r: 0.15, color: "#808080", width: 3 },
      { type: "fill", x: 0.5, y: 0.38, r: 0.15, color: "#808080" },
      // 左眼 (大)
      { type: "circle", x: 0.43, y: 0.36, r: 0.025, color: "#333", width: 2 },
      { type: "fill", x: 0.43, y: 0.36, r: 0.025, color: "#333" },
      // 右眼 (大)
      { type: "circle", x: 0.57, y: 0.36, r: 0.025, color: "#333", width: 2 },
      { type: "fill", x: 0.57, y: 0.36, r: 0.025, color: "#333" },
      // 鼻子
      { type: "circle", x: 0.5, y: 0.4, r: 0.01, color: "#333", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.4, r: 0.01, color: "#333" },
      // 胡须
      { type: "line", x: 0.38, y: 0.38, x2: 0.45, y2: 0.4, color: "#333", width: 1 },
      { type: "line", x: 0.38, y: 0.42, x2: 0.45, y2: 0.42, color: "#333", width: 1 },
      { type: "line", x: 0.62, y: 0.38, x2: 0.55, y2: 0.4, color: "#333", width: 1 },
      { type: "line", x: 0.62, y: 0.42, x2: 0.55, y2: 0.42, color: "#333", width: 1 },
      // 嘴巴
      { type: "arc", x: 0.5, y: 0.43, r: 0.02, start: 0.2, end: 2.9, color: "#333", width: 1.5 },
      // 左手臂
      { type: "line", x: 0.3, y: 0.55, x2: 0.22, y2: 0.5, color: "#808080", width: 3 },
      // 右手臂
      { type: "line", x: 0.7, y: 0.55, x2: 0.78, y2: 0.5, color: "#808080", width: 3 },
      // 肚子纹理 (竖线)
      { type: "line", x: 0.5, y: 0.55, x2: 0.5, y2: 0.78, color: "#A9A9A9", width: 1.5 },
      { type: "line", x: 0.45, y: 0.56, x2: 0.45, y2: 0.75, color: "#A9A9A9", width: 1 },
      { type: "line", x: 0.55, y: 0.56, x2: 0.55, y2: 0.75, color: "#A9A9A9", width: 1 },
    ]
  },
  "皮卡丘": {
    category: "动漫",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.18, ry: 0.22, color: "#FFD700", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.18, ry: 0.22, color: "#FFD700" },
      // 头部
      { type: "circle", x: 0.5, y: 0.35, r: 0.15, color: "#FFD700", width: 3 },
      { type: "fill", x: 0.5, y: 0.35, r: 0.15, color: "#FFD700" },
      // 左耳 (长尖)
      { type: "triangle", x: 0.38, y: 0.15, w: 0.06, h: 0.18, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.38, y: 0.15, w: 0.06, h: 0.18, color: "#FFD700" },
      // 左耳尖黑色
      { type: "triangle", x: 0.38, y: 0.08, w: 0.04, h: 0.06, color: "#333", width: 1.5 },
      { type: "fill", x: 0.38, y: 0.08, w: 0.04, h: 0.06, color: "#333" },
      // 右耳 (长尖)
      { type: "triangle", x: 0.62, y: 0.15, w: 0.06, h: 0.18, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.62, y: 0.15, w: 0.06, h: 0.18, color: "#FFD700" },
      // 右耳尖黑色
      { type: "triangle", x: 0.62, y: 0.08, w: 0.04, h: 0.06, color: "#333", width: 1.5 },
      { type: "fill", x: 0.62, y: 0.08, w: 0.04, h: 0.06, color: "#333" },
      // 左眼
      { type: "circle", x: 0.45, y: 0.33, r: 0.02, color: "#333", width: 2 },
      { type: "fill", x: 0.45, y: 0.33, r: 0.02, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.33, r: 0.02, color: "#333", width: 2 },
      { type: "fill", x: 0.55, y: 0.33, r: 0.02, color: "#333" },
      // 嘴巴
      { type: "arc", x: 0.5, y: 0.38, r: 0.015, start: 0.2, end: 2.9, color: "#333", width: 1.5 },
      // 左腮红
      { type: "circle", x: 0.42, y: 0.37, r: 0.015, color: "#FF6347", width: 1.5 },
      { type: "fill", x: 0.42, y: 0.37, r: 0.015, color: "#FF6347" },
      // 右腮红
      { type: "circle", x: 0.58, y: 0.37, r: 0.015, color: "#FF6347", width: 1.5 },
      { type: "fill", x: 0.58, y: 0.37, r: 0.015, color: "#FF6347" },
      // 棕色条纹 (背部)
      { type: "line", x: 0.45, y: 0.45, x2: 0.55, y2: 0.45, color: "#8B4513", width: 2 },
      { type: "line", x: 0.42, y: 0.5, x2: 0.58, y2: 0.5, color: "#8B4513", width: 2 },
      // 尾巴 (闪电形)
      { type: "line", x: 0.68, y: 0.65, x2: 0.78, y2: 0.55, color: "#FFD700", width: 2.5 },
      { type: "line", x: 0.78, y: 0.55, x2: 0.72, y2: 0.45, color: "#FFD700", width: 2.5 },
      { type: "line", x: 0.72, y: 0.45, x2: 0.82, y2: 0.38, color: "#FFD700", width: 2.5 },
      // 尾巴末端棕色
      { type: "rect", x: 0.78, y: 0.36, w: 0.06, h: 0.04, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.78, y: 0.36, w: 0.06, h: 0.04, color: "#8B4513" },
      // 脚
      { type: "ellipse", x: 0.44, y: 0.82, rx: 0.03, ry: 0.015, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.44, y: 0.82, rx: 0.03, ry: 0.015, color: "#FFD700" },
      { type: "ellipse", x: 0.56, y: 0.82, rx: 0.03, ry: 0.015, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.56, y: 0.82, rx: 0.03, ry: 0.015, color: "#FFD700" },
    ]
  },
  "哆啦A梦": {
    category: "动漫",
    strokes: [
      // 身体
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.18, ry: 0.22, color: "#1E90FF", width: 3 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.18, ry: 0.22, color: "#1E90FF" },
      // 头部
      { type: "circle", x: 0.5, y: 0.32, r: 0.16, color: "#1E90FF", width: 3 },
      { type: "fill", x: 0.5, y: 0.32, r: 0.16, color: "#1E90FF" },
      // 脸部 (白色)
      { type: "circle", x: 0.5, y: 0.35, r: 0.12, color: "#FFF", width: 2 },
      { type: "fill", x: 0.5, y: 0.35, r: 0.12, color: "#FFF" },
      // 肚子 (白色)
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.12, ry: 0.14, color: "#FFF", width: 2 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.12, ry: 0.14, color: "#FFF" },
      // 左眼
      { type: "circle", x: 0.45, y: 0.3, r: 0.025, color: "#333", width: 2 },
      { type: "fill", x: 0.45, y: 0.3, r: 0.025, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.3, r: 0.025, color: "#333", width: 2 },
      { type: "fill", x: 0.55, y: 0.3, r: 0.025, color: "#333" },
      // 鼻子 (红色)
      { type: "circle", x: 0.5, y: 0.33, r: 0.012, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.33, r: 0.012, color: "#FF0000" },
      // 胡须左
      { type: "line", x: 0.36, y: 0.32, x2: 0.44, y2: 0.34, color: "#333", width: 1 },
      { type: "line", x: 0.36, y: 0.36, x2: 0.44, y2: 0.36, color: "#333", width: 1 },
      { type: "line", x: 0.36, y: 0.4, x2: 0.44, y2: 0.38, color: "#333", width: 1 },
      // 胡须右
      { type: "line", x: 0.64, y: 0.32, x2: 0.56, y2: 0.34, color: "#333", width: 1 },
      { type: "line", x: 0.64, y: 0.36, x2: 0.56, y2: 0.36, color: "#333", width: 1 },
      { type: "line", x: 0.64, y: 0.4, x2: 0.56, y2: 0.38, color: "#333", width: 1 },
      // 嘴巴 (大)
      { type: "arc", x: 0.5, y: 0.4, r: 0.04, start: 0.2, end: 2.9, color: "#333", width: 1.5 },
      // 铃铛 (项圈)
      { type: "ellipse", x: 0.5, y: 0.48, rx: 0.03, ry: 0.02, color: "#FF0000", width: 2 },
      { type: "fill", x: 0.5, y: 0.48, rx: 0.03, ry: 0.02, color: "#FF0000" },
      { type: "circle", x: 0.5, y: 0.48, r: 0.015, color: "#FFD700", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.48, r: 0.015, color: "#FFD700" },
      // 四次元口袋
      { type: "arc", x: 0.5, y: 0.62, r: 0.06, start: 0, end: 3.14, color: "#333", width: 2 },
      // 手臂左
      { type: "line", x: 0.32, y: 0.55, x2: 0.25, y2: 0.5, color: "#1E90FF", width: 3 },
      // 手臂右
      { type: "line", x: 0.68, y: 0.55, x2: 0.75, y2: 0.5, color: "#1E90FF", width: 3 },
      // 脚
      { type: "ellipse", x: 0.45, y: 0.82, rx: 0.04, ry: 0.02, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.82, rx: 0.04, ry: 0.02, color: "#FFF" },
      { type: "ellipse", x: 0.55, y: 0.82, rx: 0.04, ry: 0.02, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.82, rx: 0.04, ry: 0.02, color: "#FFF" },
    ]
  },
  "海贼王": {
    category: "动漫",
    strokes: [
      // 草帽 - 帽檐
      { type: "ellipse", x: 0.5, y: 0.35, rx: 0.22, ry: 0.05, color: "#DAA520", width: 3 },
      { type: "fill", x: 0.5, y: 0.35, rx: 0.22, ry: 0.05, color: "#DAA520" },
      // 草帽 - 帽顶
      { type: "arc", x: 0.5, y: 0.35, r: 0.12, start: 3.14, end: 6.28, color: "#DAA520", width: 3 },
      { type: "fill", x: 0.5, y: 0.3, rx: 0.12, ry: 0.08, color: "#DAA520" },
      // 草帽 - 红色带子
      { type: "ellipse", x: 0.5, y: 0.32, rx: 0.12, ry: 0.02, color: "#FF0000", width: 2 },
      // 骷髅标志
      { type: "circle", x: 0.5, y: 0.28, r: 0.04, color: "#FFF", width: 2 },
      { type: "fill", x: 0.5, y: 0.28, r: 0.04, color: "#FFF" },
      // 骷髅眼睛
      { type: "circle", x: 0.48, y: 0.27, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.48, y: 0.27, r: 0.008, color: "#333" },
      { type: "circle", x: 0.52, y: 0.27, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.52, y: 0.27, r: 0.008, color: "#333" },
      // 骷髅嘴巴
      { type: "line", x: 0.47, y: 0.3, x2: 0.53, y2: 0.3, color: "#333", width: 1 },
      // 交叉骨
      { type: "line", x: 0.44, y: 0.35, x2: 0.56, y2: 0.45, color: "#FFF", width: 2 },
      { type: "line", x: 0.56, y: 0.35, x2: 0.44, y2: 0.45, color: "#FFF", width: 2 },
      // 身体
      { type: "ellipse", x: 0.5, y: 0.65, rx: 0.15, ry: 0.2, color: "#FF8C00", width: 3 },
      { type: "fill", x: 0.5, y: 0.65, rx: 0.15, ry: 0.2, color: "#FF8C00" },
      // 披风
      { type: "arc", x: 0.5, y: 0.6, r: 0.22, start: 0, end: 3.14, color: "#333", width: 2.5 },
      // 左臂
      { type: "line", x: 0.35, y: 0.58, x2: 0.28, y2: 0.5, color: "#FF8C00", width: 2.5 },
      // 右臂
      { type: "line", x: 0.65, y: 0.58, x2: 0.72, y2: 0.5, color: "#FF8C00", width: 2.5 },
    ]
  },
  "火影": {
    category: "动漫",
    strokes: [
      // 头发 (金色刺猬头)
      { type: "triangle", x: 0.5, y: 0.18, w: 0.2, h: 0.15, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.5, y: 0.18, w: 0.2, h: 0.15, color: "#FFD700" },
      // 头发侧左
      { type: "triangle", x: 0.38, y: 0.22, w: 0.08, h: 0.1, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.38, y: 0.22, w: 0.08, h: 0.1, color: "#FFD700" },
      // 头发侧右
      { type: "triangle", x: 0.62, y: 0.22, w: 0.08, h: 0.1, color: "#FFD700", width: 2 },
      { type: "fill", x: 0.62, y: 0.22, w: 0.08, h: 0.1, color: "#FFD700" },
      // 脸部
      { type: "circle", x: 0.5, y: 0.35, r: 0.12, color: "#FFE4B5", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.35, r: 0.12, color: "#FFE4B5" },
      // 护额
      { type: "rect", x: 0.38, y: 0.25, w: 0.24, h: 0.04, color: "#333", width: 2 },
      { type: "fill", x: 0.38, y: 0.25, w: 0.24, h: 0.04, color: "#333" },
      // 护额金属
      { type: "rect", x: 0.42, y: 0.25, w: 0.16, h: 0.03, color: "#C0C0C0", width: 1.5 },
      { type: "fill", x: 0.42, y: 0.25, w: 0.16, h: 0.03, color: "#C0C0C0" },
      // 木叶标志
      { type: "circle", x: 0.5, y: 0.265, r: 0.01, color: "#333", width: 1 },
      // 左眼
      { type: "circle", x: 0.45, y: 0.33, r: 0.015, color: "#6BB5FF", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.33, r: 0.015, color: "#6BB5FF" },
      { type: "circle", x: 0.45, y: 0.33, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.45, y: 0.33, r: 0.008, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.33, r: 0.015, color: "#6BB5FF", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.33, r: 0.015, color: "#6BB5FF" },
      { type: "circle", x: 0.55, y: 0.33, r: 0.008, color: "#333", width: 1 },
      { type: "fill", x: 0.55, y: 0.33, r: 0.008, color: "#333" },
      // 眉毛
      { type: "line", x: 0.42, y: 0.3, x2: 0.48, y2: 0.31, color: "#FFD700", width: 1.5 },
      { type: "line", x: 0.58, y: 0.3, x2: 0.52, y2: 0.31, color: "#FFD700", width: 1.5 },
      // 嘴巴
      { type: "line", x: 0.47, y: 0.4, x2: 0.53, y2: 0.4, color: "#333", width: 1.5 },
      // 脸颊标记 (胡须)
      { type: "line", x: 0.38, y: 0.35, x2: 0.42, y2: 0.35, color: "#333", width: 1 },
      { type: "line", x: 0.38, y: 0.37, x2: 0.42, y2: 0.37, color: "#333", width: 1 },
      { type: "line", x: 0.62, y: 0.35, x2: 0.58, y2: 0.35, color: "#333", width: 1 },
      { type: "line", x: 0.62, y: 0.37, x2: 0.58, y2: 0.37, color: "#333", width: 1 },
      // 身体
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.15, ry: 0.2, color: "#FF8C00", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.15, ry: 0.2, color: "#FF8C00" },
      // 衣领
      { type: "line", x: 0.42, y: 0.5, x2: 0.5, y2: 0.52, color: "#FFF", width: 1.5 },
      { type: "line", x: 0.58, y: 0.5, x2: 0.5, y2: 0.52, color: "#FFF", width: 1.5 },
    ]
  },
  "柯南": {
    category: "动漫",
    strokes: [
      // 头部
      { type: "circle", x: 0.5, y: 0.3, r: 0.14, color: "#FFE4B5", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.3, r: 0.14, color: "#FFE4B5" },
      // 头发 (前额)
      { type: "arc", x: 0.5, y: 0.2, r: 0.12, start: 3.14, end: 6.28, color: "#333", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.2, rx: 0.13, ry: 0.06, color: "#333" },
      // 头发尖
      { type: "triangle", x: 0.5, y: 0.17, w: 0.04, h: 0.04, color: "#333", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.17, w: 0.04, h: 0.04, color: "#333" },
      // 眼镜 - 左框
      { type: "circle", x: 0.43, y: 0.3, r: 0.035, color: "#333", width: 2 },
      // 眼镜 - 右框
      { type: "circle", x: 0.57, y: 0.3, r: 0.035, color: "#333", width: 2 },
      // 眼镜 - 鼻梁
      { type: "line", x: 0.465, y: 0.3, x2: 0.535, y2: 0.3, color: "#333", width: 1.5 },
      // 眼镜腿
      { type: "line", x: 0.395, y: 0.29, x2: 0.36, y2: 0.28, color: "#333", width: 1.5 },
      { type: "line", x: 0.605, y: 0.29, x2: 0.64, y2: 0.28, color: "#333", width: 1.5 },
      // 左眼
      { type: "circle", x: 0.43, y: 0.3, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.43, y: 0.3, r: 0.015, color: "#333" },
      // 右眼
      { type: "circle", x: 0.57, y: 0.3, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.57, y: 0.3, r: 0.015, color: "#333" },
      // 嘴巴
      { type: "line", x: 0.47, y: 0.38, x2: 0.53, y2: 0.38, color: "#333", width: 1.5 },
      // 蝴蝶结
      { type: "triangle", x: 0.5, y: 0.45, w: 0.06, h: 0.03, color: "#FF0000", width: 2 },
      { type: "fill", x: 0.5, y: 0.45, w: 0.06, h: 0.03, color: "#FF0000" },
      // 蝴蝶结左
      { type: "triangle", x: 0.47, y: 0.45, w: 0.04, h: 0.03, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.47, y: 0.45, w: 0.04, h: 0.03, color: "#FF0000" },
      // 蝴蝶结右
      { type: "triangle", x: 0.53, y: 0.45, w: 0.04, h: 0.03, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.53, y: 0.45, w: 0.04, h: 0.03, color: "#FF0000" },
      // 身体 (西装)
      { type: "ellipse", x: 0.5, y: 0.62, rx: 0.15, ry: 0.2, color: "#4169E1", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.62, rx: 0.15, ry: 0.2, color: "#4169E1" },
      // 衣领
      { type: "triangle", x: 0.5, y: 0.48, w: 0.12, h: 0.06, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.48, w: 0.12, h: 0.06, color: "#FFF" },
    ]
  },
  "千与千寻": {
    category: "动漫",
    strokes: [
      // 头部
      { type: "circle", x: 0.5, y: 0.28, r: 0.13, color: "#FFE4B5", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.28, r: 0.13, color: "#FFE4B5" },
      // 头发 (黑色)
      { type: "arc", x: 0.5, y: 0.22, r: 0.14, start: 3.14, end: 6.28, color: "#333", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.22, rx: 0.14, ry: 0.07, color: "#333" },
      // 头发侧左
      { type: "line", x: 0.37, y: 0.25, x2: 0.37, y2: 0.38, color: "#333", width: 2.5 },
      // 头发侧右
      { type: "line", x: 0.63, y: 0.25, x2: 0.63, y2: 0.38, color: "#333", width: 2.5 },
      // 发绳 (红色)
      { type: "circle", x: 0.37, y: 0.35, r: 0.008, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.37, y: 0.35, r: 0.008, color: "#FF0000" },
      { type: "circle", x: 0.63, y: 0.35, r: 0.008, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.63, y: 0.35, r: 0.008, color: "#FF0000" },
      // 刘海
      { type: "line", x: 0.44, y: 0.18, x2: 0.44, y2: 0.24, color: "#333", width: 2 },
      { type: "line", x: 0.5, y: 0.17, x2: 0.5, y2: 0.23, color: "#333", width: 2 },
      { type: "line", x: 0.56, y: 0.18, x2: 0.56, y2: 0.24, color: "#333", width: 2 },
      // 左眼
      { type: "circle", x: 0.45, y: 0.28, r: 0.018, color: "#333", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.28, r: 0.018, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.28, r: 0.018, color: "#333", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.28, r: 0.018, color: "#333" },
      // 眉毛
      { type: "line", x: 0.42, y: 0.25, x2: 0.48, y2: 0.26, color: "#333", width: 1 },
      { type: "line", x: 0.58, y: 0.25, x2: 0.52, y2: 0.26, color: "#333", width: 1 },
      // 鼻子
      { type: "line", x: 0.5, y: 0.3, x2: 0.5, y2: 0.32, color: "#333", width: 1 },
      // 嘴巴 (微笑)
      { type: "arc", x: 0.5, y: 0.35, r: 0.02, start: 0.2, end: 2.9, color: "#333", width: 1.5 },
      // 身体 (红色和服)
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.16, ry: 0.22, color: "#FF0000", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.16, ry: 0.22, color: "#FF0000" },
      // 腰带 (白色)
      { type: "rect", x: 0.36, y: 0.55, w: 0.28, h: 0.04, color: "#FFF", width: 2 },
      { type: "fill", x: 0.36, y: 0.55, w: 0.28, h: 0.04, color: "#FFF" },
      // 袖子
      { type: "line", x: 0.34, y: 0.55, x2: 0.28, y2: 0.65, color: "#FF0000", width: 2.5 },
      { type: "line", x: 0.66, y: 0.55, x2: 0.72, y2: 0.65, color: "#FF0000", width: 2.5 },
    ]
  },
  "幽灵公主": {
    category: "动漫",
    strokes: [
      // 头部
      { type: "circle", x: 0.5, y: 0.28, r: 0.12, color: "#FFE4B5", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.28, r: 0.12, color: "#FFE4B5" },
      // 头发 (黑色长直)
      { type: "arc", x: 0.5, y: 0.22, r: 0.14, start: 3.14, end: 6.28, color: "#333", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.22, rx: 0.14, ry: 0.07, color: "#333" },
      // 长发
      { type: "line", x: 0.38, y: 0.3, x2: 0.35, y2: 0.55, color: "#333", width: 2 },
      { type: "line", x: 0.62, y: 0.3, x2: 0.65, y2: 0.55, color: "#333", width: 2 },
      // 左眼
      { type: "circle", x: 0.45, y: 0.27, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.27, r: 0.015, color: "#333" },
      // 右眼
      { type: "circle", x: 0.55, y: 0.27, r: 0.015, color: "#333", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.27, r: 0.015, color: "#333" },
      // 眉毛 (坚定)
      { type: "line", x: 0.42, y: 0.24, x2: 0.48, y2: 0.25, color: "#333", width: 1.5 },
      { type: "line", x: 0.58, y: 0.24, x2: 0.52, y2: 0.25, color: "#333", width: 1.5 },
      // 鼻子
      { type: "line", x: 0.5, y: 0.3, x2: 0.5, y2: 0.32, color: "#333", width: 1 },
      // 嘴巴 (严肃)
      { type: "line", x: 0.47, y: 0.35, x2: 0.53, y2: 0.35, color: "#333", width: 1.5 },
      // 红色脸颊印记
      { type: "circle", x: 0.42, y: 0.3, r: 0.006, color: "#FF0000", width: 1 },
      { type: "fill", x: 0.42, y: 0.3, r: 0.006, color: "#FF0000" },
      { type: "circle", x: 0.58, y: 0.3, r: 0.006, color: "#FF0000", width: 1 },
      { type: "fill", x: 0.58, y: 0.3, r: 0.006, color: "#FF0000" },
      // 身体 (蓝色和服)
      { type: "ellipse", x: 0.5, y: 0.6, rx: 0.15, ry: 0.22, color: "#4169E1", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.6, rx: 0.15, ry: 0.22, color: "#4169E1" },
      // 红色腰带
      { type: "rect", x: 0.37, y: 0.55, w: 0.26, h: 0.03, color: "#FF0000", width: 2 },
      { type: "fill", x: 0.37, y: 0.55, w: 0.26, h: 0.03, color: "#FF0000" },
      // 白色面具 (挂在腰上)
      { type: "circle", x: 0.5, y: 0.7, r: 0.02, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.7, r: 0.02, color: "#FFF" },
      // 面具眼睛
      { type: "circle", x: 0.49, y: 0.695, r: 0.004, color: "#333", width: 1 },
      { type: "fill", x: 0.49, y: 0.695, r: 0.004, color: "#333" },
      { type: "circle", x: 0.51, y: 0.695, r: 0.004, color: "#333", width: 1 },
      { type: "fill", x: 0.51, y: 0.695, r: 0.004, color: "#333" },
    ]
  },
  "天空之城": {
    category: "动漫",
    strokes: [
      // 天空
      { type: "rect", x: 0, y: 0, w: 1, h: 1, color: "#87CEEB", width: 1 },
      { type: "fill", x: 0, y: 0, w: 1, h: 1, color: "#87CEEB" },
      // 云朵 - 底座
      { type: "ellipse", x: 0.5, y: 0.75, rx: 0.35, ry: 0.08, color: "#FFF", width: 2 },
      { type: "fill", x: 0.5, y: 0.75, rx: 0.35, ry: 0.08, color: "#FFF" },
      // 云朵 - 上层
      { type: "circle", x: 0.35, y: 0.72, r: 0.06, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.35, y: 0.72, r: 0.06, color: "#FFF" },
      { type: "circle", x: 0.45, y: 0.7, r: 0.08, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.45, y: 0.7, r: 0.08, color: "#FFF" },
      { type: "circle", x: 0.55, y: 0.7, r: 0.08, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.55, y: 0.7, r: 0.08, color: "#FFF" },
      { type: "circle", x: 0.65, y: 0.72, r: 0.06, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.65, y: 0.72, r: 0.06, color: "#FFF" },
      // 城堡主体
      { type: "rect", x: 0.38, y: 0.35, w: 0.24, h: 0.35, color: "#D2B48C", width: 2.5 },
      { type: "fill", x: 0.38, y: 0.35, w: 0.24, h: 0.35, color: "#D2B48C" },
      // 城堡塔楼左
      { type: "rect", x: 0.35, y: 0.3, w: 0.06, h: 0.4, color: "#D2B48C", width: 2 },
      { type: "fill", x: 0.35, y: 0.3, w: 0.06, h: 0.4, color: "#D2B48C" },
      // 城堡塔楼右
      { type: "rect", x: 0.59, y: 0.3, w: 0.06, h: 0.4, color: "#D2B48C", width: 2 },
      { type: "fill", x: 0.59, y: 0.3, w: 0.06, h: 0.4, color: "#D2B48C" },
      // 城堡屋顶左
      { type: "triangle", x: 0.38, y: 0.3, w: 0.1, h: 0.08, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.38, y: 0.3, w: 0.1, h: 0.08, color: "#8B4513" },
      // 城堡屋顶右
      { type: "triangle", x: 0.62, y: 0.3, w: 0.1, h: 0.08, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.62, y: 0.3, w: 0.1, h: 0.08, color: "#8B4513" },
      // 城堡屋顶主
      { type: "triangle", x: 0.5, y: 0.35, w: 0.28, h: 0.12, color: "#8B4513", width: 2 },
      { type: "fill", x: 0.5, y: 0.35, w: 0.28, h: 0.12, color: "#8B4513" },
      // 窗户
      { type: "circle", x: 0.5, y: 0.45, r: 0.02, color: "#4A90D9", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.45, r: 0.02, color: "#4A90D9" },
      // 大门
      { type: "rect", x: 0.48, y: 0.58, w: 0.04, h: 0.08, color: "#8B4513", width: 1.5 },
      { type: "fill", x: 0.48, y: 0.58, w: 0.04, h: 0.08, color: "#8B4513" },
      // 藤蔓
      { type: "line", x: 0.38, y: 0.5, x2: 0.38, y2: 0.65, color: "#228B22", width: 1.5 },
      { type: "line", x: 0.62, y: 0.5, x2: 0.62, y2: 0.65, color: "#228B22", width: 1.5 },
      // 小云朵
      { type: "circle", x: 0.15, y: 0.2, r: 0.03, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.15, y: 0.2, r: 0.03, color: "#FFF" },
      { type: "circle", x: 0.2, y: 0.18, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.2, y: 0.18, r: 0.04, color: "#FFF" },
      { type: "circle", x: 0.25, y: 0.2, r: 0.03, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.25, y: 0.2, r: 0.03, color: "#FFF" },
      // 小云朵2
      { type: "circle", x: 0.75, y: 0.25, r: 0.03, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.75, y: 0.25, r: 0.03, color: "#FFF" },
      { type: "circle", x: 0.8, y: 0.23, r: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.8, y: 0.23, r: 0.04, color: "#FFF" },
      { type: "circle", x: 0.85, y: 0.25, r: 0.03, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.85, y: 0.25, r: 0.03, color: "#FFF" },
    ]
  },
  "龙珠": {
    category: "动漫",
    strokes: [
      // 神龙身体 (S形)
      { type: "arc", x: 0.5, y: 0.55, r: 0.15, start: 0.5, end: 2.5, color: "#228B22", width: 4 },
      { type: "arc", x: 0.5, y: 0.35, r: 0.12, start: 0.8, end: 2.8, color: "#228B22", width: 4 },
      // 龙头
      { type: "ellipse", x: 0.5, y: 0.25, rx: 0.1, ry: 0.07, color: "#228B22", width: 3 },
      { type: "fill", x: 0.5, y: 0.25, rx: 0.1, ry: 0.07, color: "#228B22" },
      // 龙角左
      { type: "line", x: 0.45, y: 0.2, x2: 0.42, y2: 0.14, color: "#8B4513", width: 2.5 },
      // 龙角右
      { type: "line", x: 0.55, y: 0.2, x2: 0.58, y2: 0.14, color: "#8B4513", width: 2.5 },
      // 龙眼左
      { type: "circle", x: 0.46, y: 0.24, r: 0.015, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.46, y: 0.24, r: 0.015, color: "#FF0000" },
      // 龙眼右
      { type: "circle", x: 0.54, y: 0.24, r: 0.015, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.54, y: 0.24, r: 0.015, color: "#FF0000" },
      // 龙须
      { type: "line", x: 0.42, y: 0.27, x2: 0.35, y2: 0.3, color: "#228B22", width: 1.5 },
      { type: "line", x: 0.58, y: 0.27, x2: 0.65, y2: 0.3, color: "#228B22", width: 1.5 },
      // 龙嘴
      { type: "arc", x: 0.5, y: 0.28, r: 0.02, start: 0.2, end: 2.9, color: "#333", width: 1.5 },
      // 龙鳞纹理
      { type: "arc", x: 0.5, y: 0.42, r: 0.02, start: 0, end: 3.14, color: "#006400", width: 1.5 },
      { type: "arc", x: 0.5, y: 0.5, r: 0.02, start: 0, end: 3.14, color: "#006400", width: 1.5 },
      { type: "arc", x: 0.5, y: 0.58, r: 0.02, start: 0, end: 3.14, color: "#006400", width: 1.5 },
      // 龙爪
      { type: "line", x: 0.38, y: 0.45, x2: 0.32, y2: 0.42, color: "#228B22", width: 2.5 },
      { type: "line", x: 0.62, y: 0.45, x2: 0.68, y2: 0.42, color: "#228B22", width: 2.5 },
      // 龙珠 (球)
      { type: "circle", x: 0.5, y: 0.72, r: 0.06, color: "#FFD700", width: 2.5 },
      { type: "fill", x: 0.5, y: 0.72, r: 0.06, color: "#FFD700" },
      // 龙珠星星
      { type: "circle", x: 0.5, y: 0.72, r: 0.015, color: "#FF0000", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.72, r: 0.015, color: "#FF0000" },
      // 龙珠周围光芒
      { type: "line", x: 0.5, y: 0.64, x2: 0.5, y2: 0.62, color: "#FFD700", width: 1 },
      { type: "line", x: 0.5, y: 0.8, x2: 0.5, y2: 0.82, color: "#FFD700", width: 1 },
      { type: "line", x: 0.42, y: 0.72, x2: 0.4, y2: 0.72, color: "#FFD700", width: 1 },
      { type: "line", x: 0.58, y: 0.72, x2: 0.6, y2: 0.72, color: "#FFD700", width: 1 },
      // 云
      { type: "ellipse", x: 0.5, y: 0.85, rx: 0.25, ry: 0.04, color: "#FFF", width: 1.5 },
      { type: "fill", x: 0.5, y: 0.85, rx: 0.25, ry: 0.04, color: "#FFF" },
    ]
  },
};