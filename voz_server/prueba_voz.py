"""Prueba del servicio de voz desde dentro del contenedor: un tono de 2 s (sin voz real).
Comprueba que sin token responde 401 y con token responde 200 con el texto y el tiempo."""
import io
import math
import os
import struct
import urllib.error
import urllib.request
import wave

b = io.BytesIO()
w = wave.open(b, 'wb')
w.setnchannels(1)
w.setsampwidth(2)
w.setframerate(16000)
w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 440 * i / 16000))) for i in range(16000 * 2)))
w.close()
audio = b.getvalue()
frontera = '----prueba'
cuerpo = (f'--{frontera}\r\nContent-Disposition: form-data; name="archivo"; filename="t.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + audio + f'\r\n--{frontera}--\r\n'.encode()


def llamar(token):
    r = urllib.request.Request('http://localhost:8000/transcribir', data=cuerpo, method='POST',
                               headers={'Content-Type': f'multipart/form-data; boundary={frontera}', 'X-Voz-Token': token})
    try:
        return urllib.request.urlopen(r, timeout=120).read().decode()
    except urllib.error.HTTPError as e:
        return f'HTTP {e.code}'


print('sin token:', llamar('malo'))
print('con token:', llamar(os.environ.get('VOZ_TOKEN', '')))
