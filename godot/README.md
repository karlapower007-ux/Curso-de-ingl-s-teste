# Professores IA — Godot Free Avatar Engine v2.2

Esta branch preserva integralmente a versão Rive v2.1 e adiciona um **motor alternativo gratuito em Godot 4.x**.

## O que já está implementado

- quatro perfis: Lily, Oliver, Sara e Sofía;
- estados `idle / listening / thinking / speaking`;
- 16 emoções;
- 12 visemas;
- piscadas automáticas;
- respiração;
- olhar independente;
- inclinação/movimento de cabeça;
- microanimação durante a fala;
- API de comandos;
- ponte para Web export via `JavaScriptBridge`;
- fallback conceitual: o contrato de estados não depende de Rive.

O desenho procedural existente nesta prova serve para validar o **motor**. A arte final pode ser trocada por um rig 2D/2.5D em camadas sem alterar a API.

## Teste local

Abra o projeto no Godot 4.x e execute a cena principal.

Atalhos:

- `1`: idle
- `2`: listening
- `3`: thinking
- `4`: speaking
- `H`: happy
- `E`: encouraging
- `S`: surprised
- `R`: serious
- `SPACE`: próximo visema
- `TAB`: próximo professor

## Integração com o programa

Na exportação Web, o pai pode chamar:

```js
iframe.contentWindow._professoresGodotCommand(JSON.stringify({
  type: "set_mode",
  mode: "speaking"
}));
```

Lip-sync:

```js
iframe.contentWindow._professoresGodotCommand(JSON.stringify({
  type: "set_viseme",
  viseme: "A",
  strength: 0.9
}));
```

Emoção:

```js
iframe.contentWindow._professoresGodotCommand(JSON.stringify({
  type: "set_emotion",
  emotion: "encouraging",
  strength: 0.75
}));
```

## Decisão de arquitetura

Não removi Rive. Esta implementação é paralela e reversível. O objetivo é comparar custo zero, qualidade de movimento e facilidade de integração antes de substituir o renderer aceito.
