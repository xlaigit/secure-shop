import socketio
import threading

def attack():
    sio = socketio.Client()
    try:
        sio.connect('http://localhost:3000')
        sio.emit('msg', {'user': 'bot', 'msg': '攻击'})
    except:
        pass

for i in range(100):
    threading.Thread(target=attack).start()
    print(f'连接 {i+1}')