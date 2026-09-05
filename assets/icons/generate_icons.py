#!/usr/bin/env python3
"""Gera os ícones da Héstia a partir do novo PNG oficial (src/assets/ka-apple.png).

Redimensiona o ícone de maior resolução para todos os alvos necessários 
preservando a proporção de 1:1 com alta qualidade (Lanczos).
"""

import os
from PIL import Image

SIZES = [512, 256, 192, 128, 64, 48]

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(os.path.dirname(script_dir))
    
    # Fonte canônica
    src_path = os.path.join(root_dir, "src", "assets", "ka-apple.png")
    if not os.path.exists(src_path):
        print(f"Erro: Fonte canônica ausente em {src_path}")
        return

    img = Image.open(src_path)
    
    # Gerar os ícones na pasta assets/icons/
    for size in SIZES:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        
        # Salva em assets/icons/hestia-console-{size}.png
        dest_path = os.path.join(script_dir, f"hestia-console-{size}.png")
        resized.save(dest_path)
        print(f"wrote {dest_path}")
        
        # Salva em public/icons/hestia-{size}.png se for 192 ou 512
        if size in [192, 512]:
            pub_dest = os.path.join(root_dir, "public", "icons", f"hestia-{size}.png")
            resized.save(pub_dest)
            print(f"wrote {pub_dest}")

    # Alias genérico (512px)
    generic = os.path.join(script_dir, "hestia-console.png")
    img.resize((512, 512), Image.Resampling.LANCZOS).save(generic)
    print(f"wrote {generic}")

if __name__ == "__main__":
    main()
