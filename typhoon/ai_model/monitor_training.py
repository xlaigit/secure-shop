#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
训练进度监测脚本
每5分钟检查一次训练状态，模型全部保存后自动运行评估
"""
import os, time, json, datetime, subprocess, sys

MODEL_DIR = r'D:/AI_Model/ensemble_ocean_v2'
SCALER_PATH = r'D:/AI_Model/track_scaler_ocean_v2.pkl'
AUTO_DEPLOY = os.path.join(os.path.dirname(__file__), 'auto_deploy_best.py')
LOG_PATH = r'D:/AI_Model/training_monitor_log.txt'

SEEDS = [42, 123, 777]
EXPECTED = [f'model_{i+1}_seed{s}.h5' for i, s in enumerate(SEEDS)]

def log(msg):
    ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{ts}] {msg}'
    print(line)
    with open(LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(line + '\n')

def check_status():
    if not os.path.exists(MODEL_DIR):
        return []
    return [f for f in os.listdir(MODEL_DIR) if f.endswith('.h5')]

def main():
    log('=' * 50)
    log('训练监测脚本启动')
    log(f'目标目录: {MODEL_DIR}')
    log(f'期望文件: {EXPECTED}')
    log('=' * 50)

    last_count = 0
    no_change_rounds = 0
    idle_timeout = 60  # 1小时无变化视为训练结束

    while True:
        existing = check_status()
        count = len(existing)
        missing = [f for f in EXPECTED if f not in existing]

        if not missing:
            log('✅ 所有3个模型训练完成！')
            log(f'已保存: {existing}')
            # 等待5秒确保文件写完毕
            time.sleep(5)
            # 运行自动部署
            log('🚀 启动自动部署评估...')
            try:
                result = subprocess.run(
                    [sys.executable, AUTO_DEPLOY],
                    capture_output=True, text=True, timeout=7200
                )
                log('部署输出:\n' + result.stdout)
                if result.stderr:
                    log('部署错误:\n' + result.stderr)
                log('✅ 自动部署完成！')
            except Exception as e:
                log(f'❌ 自动部署失败: {e}')
            break

        if count > last_count:
            log(f'📊 新模型保存！当前: {existing}, 剩余: {missing}')
            last_count = count
            no_change_rounds = 0
        else:
            no_change_rounds += 1

        # 如果长时间无变化且已有模型，检查进程是否还在
        if no_change_rounds >= 12:  # 1小时无变化
            # 检查Python进程
            import psutil
            python_processes = [p for p in psutil.process_iter(['pid', 'name', 'cmdline'])
                               if p.info['name'] and 'python' in p.info['name'].lower()]
            train_running = False
            for p in python_processes:
                try:
                    cmd = ' '.join(p.info['cmdline'] or [])
                    if 'train_ensemble_ocean' in cmd:
                        train_running = True
                        break
                except:
                    pass
            if not train_running and count > 0:
                log(f'⚠️ 训练进程已结束，但模型未完全保存。已保存: {existing}')
                log('尝试运行自动部署评估已有模型...')
                try:
                    subprocess.run([sys.executable, AUTO_DEPLOY], capture_output=True, text=True, timeout=7200)
                except Exception as e:
                    log(f'部署失败: {e}')
                break

        log(f'⏳ 监测中... 已保存 {count}/3 ({existing}), 剩余: {missing}')
        time.sleep(300)  # 5分钟检查一次

if __name__ == '__main__':
    main()