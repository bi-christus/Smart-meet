Closes #

<!--
A linha acima é obrigatória e vai com o número da Issue: `Closes #12`.
É ela que mantém Issue e código amarrados depois que a conversa some.
PR sem Issue é rejeitado — a tarefa vira Issue antes do código. Ver AGENTS.md §1.
-->

## O que muda, para quem usa

<!-- Uma ou duas frases, no vocabulário de quem abre o sistema — não o da implementação. -->

## Por que assim

<!--
A decisão de projeto e a alternativa descartada. Este campo é o mesmo espírito dos
comentários do repositório: o código já diz o que faz; aqui fica o porquê.
Se a mudança foi óbvia, escreva "óbvia" e siga.
-->

## Como conferir no preview

<!--
A Vercel publica um Preview Deployment por PR. Diga o caminho exato até a mudança:
qual aba, qual estado, o que olhar. Se não dá para ver na tela, diga como se verifica.
-->

## Risco

<!--
O que pode quebrar, e o que acontece se quebrar em produção. "Nenhum" é resposta
aceitável quando for verdade. Se mexeu em regra do Firestore, em `prebuild`, ou na
fronteira de demandas, diga aqui.
-->

---

- [ ] `npm run lint` passa
- [ ] `npx next typegen && npx tsc --noEmit` passa <!-- typegen ANTES: sem ele o tsc checa árvore incompleta. AGENTS.md §1.5 -->
- [ ] `npm run prebuild` passa
- [ ] Conferido no Preview Deployment da Vercel
- [ ] Regras do Firestore publicadas **antes** deste merge, se o código novo depende delas
