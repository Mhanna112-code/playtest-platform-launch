# Sent work: panels, folds, Added, locked parts (batch 35 §136–§140)

Taken on a separate dev server (port 3486, its own schema `rec_sent`, the fake Stripe) with throwaway `@playtest.test` accounts. Each picture is at
1280 wide (`-desktop`) and 390 wide (`-phone`).

## §139 Panels and folds

| Picture | What it shows |
|---|---|
| `panel-needs-default-*` | A long written answer in Needs you at the panel's default size (at most 12rem / 40% of the screen): the Pay box under it is in view without dragging. |
| `panel-row-default-*` | The same on a tester's row: a paid part's answers, then its Pay more box. |
| `panel-needs-shorter-desktop` | The grip dragged up: the panel is shorter than its default (92 px; it can go down to 80). |
| `panel-needs-taller-desktop` | The grip dragged down (442 px; at most 60% of the screen). The content scrolls inside at any height. Both heights stayed after a live redraw and a reload (sessionStorage). |
| `panel-needs-body-closed-*` | The body fold ("Their written answers") closed; the Pay fold stays open: each has its own toggle. |
