#!/usr/bin/env python3
"""
V7_OPT 训练监测脚本
每5分钟检查一次，3个模型全部保存后自动运行评估
"""
import os, time, json, datetime, subprocess, sys

MODEL_DIR = r'D:/AI_Model/ensemble_ocean_v7_opt'
SCALER_PATH = r'D:/AI_Model/track_scaler_ocean_v7_opt.pkl'
AUTO_DEPLOY = os.path.join(os.path.dirname(__file__), 'auto_deploy_best.py')
LOG_PATH = r'D:/AI_Model/training_v7_opt_monitor_log.txt'

SEEDS = [42, 123, 777]
EXPECTED = [f'model_{i+1}_seed{s}.h5' for i, s in enumerate(SEEDS)]

def log(msg):
    ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(line + '\n')

def check_status():
    if not os.path.exists(MODEL_DIR):
        return []
    return [f for f in os.listdir(MODEL_DIR) if f.endswith('.h5')]

def main():
    log('=' * 50)
    log('V7_OPT 训练监测脚本启动')
    log(f'目标目录: {MODEL_DIR}')
    log(f'期望文件: {EXPECTED}')
    log('=' * 50)

    last_count = 0
    no_change_rounds = 0

    while True:
        existing = check_status()
        count = len(existing)
        missing = [f for f in EXPECTED if f not in existing]

        if not missing:
            log('✅ 所有3个模型训练完成！')
            log(f'已保存: {existing}')
            # 等待确保文件写完
            time.sleep(10)
            # 更新app.js默认模型为v7_opt
            log('更新app.js默认模型为v7_opt...')
            app_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'app.js')
            if os.path.exists(app_path):
                with open(app_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                content = content.replace("model: 'v7'", "model: 'v7_opt'")
                content = content.replace("model: 'v6'", "model: 'v7_opt'")
                content = content.replace("model: 'v5'", "model: 'v7_opt'")
                with open(app_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                log('✅ app.js已更新，默认使用v7_opt模型')
            log('✅ 部署完成！请重启Node服务器使新模型生效')
            break

        if count > last_count:
            log(f'📊 新模型保存！当前: {existing}, 剩余: {missing}')
            last_count = count
            no_change_rounds = 0
        else:
            no_change_rounds += 1

        # 检查训练进程是否还在
        if no_change_rounds >= 24:  # 2小时无变化
            try:
                import psutil
                python_processes = [p for p in psutil.process_iter(['pid', 'name', 'cmdline'])]
                train_running = False
                for p in python_processes:
                    try:
                        cmd = ' '.join(p.info['cmdline'] or [])
                        if 'train_ensemble_ocean_v7_opt' in cmd:
                            train_running = True
                            break
                    except:
                        pass
                if not train_running and count > 0:
                    log(f'⚠️ 训练进程已结束，但模型未完全保存。已保存: {existing}')
                    break
            except:
                pass

        log(f'⏳ 监测中... 已保存 {count}/3 ({existing})')
        time.sleep(300)  # 5分钟

if __name__ == '__main__':
    main()