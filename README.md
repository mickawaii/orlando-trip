# Orlando Rota — Disney World 2026 Tracker

Roteiro e rastreador de despesas da viagem a Orlando (Disney World), 11–15 de janeiro de 2026.

App web mobile-first com:

- Countdown até a viagem
- Guia rápido: Airbnb, lotação dos parques, dining, schedule, custos
- Calendário de crowds por parque (dados observados + estimativas)
- Diárias do Universal Helios Grand Hotel (nov/dez 2026, scrape oficial)
- Itinerário diário sincronizado (Supabase)
- Divisão de custos por pessoa (Jackie, Alex, Crystal, Erica & Kids)
- Galeria do Airbnb
- Modo admin (edição de itinerário e marcar pagamentos)

## Stack

- HTML / CSS / JavaScript (vanilla)
- [Supabase](https://supabase.com) para sync em tempo real
- SortableJS para reordenar o roteiro
- Deploy estático (ex.: Vercel)

## Como rodar localmente

Qualquer servidor estático na raiz do projeto:

```bash
python3 -m http.server 5173
```

Abra `http://localhost:5173`.

## Estrutura

```
index.html      # UI principal e modais
style.css       # Tema Disney / glass
main.js         # Lógica, Supabase e interações
manifest.json   # PWA básico
images/         # Personagens, Airbnb, carro
```
