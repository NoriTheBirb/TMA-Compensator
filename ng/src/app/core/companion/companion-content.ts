export type CompanionMood =
  | 'default'
  | 'angry'
  | 'worried'
  | 'lunch_1'
  | 'lunch_2'
  | 'end_shift'
  | 'dead'
  | 'congrats'
  | 'tablet'
  | 'admin_message';

export type CompanionPose = 'idle' | 'speaking';

export type CompanionSpriteKey = `${CompanionMood}_${CompanionPose}`;

export type CompanionTone = 'funny' | 'serious' | 'angry' | 'neutral';

export const COMPANION_SPRITES: Record<'normal' | 'sprint', Partial<Record<CompanionSpriteKey, string | string[]>>> = {
  normal: {
    default_idle: ['images/Idle (1).png', 'images/Reading-idle (1).png'],
    default_speaking: 'images/Speaking (1).png',

    angry_idle: 'images/Angry-Photoroom.png',
    angry_speaking: 'images/AngrySpeaking-Photoroom.png',

    worried_idle: 'images/Worried.png',
    worried_speaking: 'images/Worried.png',

    lunch_1_idle: 'images/LunchFirstHalf-Photoroom.png',
    lunch_1_speaking: 'images/LunchFirstHalf-Photoroom.png',
    lunch_2_idle: 'images/LunchSecondHalf-Photoroom.png',
    lunch_2_speaking: 'images/LunchSecondHalf-Photoroom.png',

    end_shift_idle: 'images/EndShiftGood.png',
    end_shift_speaking: 'images/EndShiftGood.png',

    dead_idle: 'images/Dead.png',
    dead_speaking: 'images/Dead.png',

    congrats_idle: 'images/Congratulations (1).png',
    congrats_speaking: 'images/Congratulations (1).png',

    // Tablet pose counts as an "idle" when not speaking.
    tablet_idle: 'images/Reading-idle (1).png',
    tablet_speaking: 'images/Reading-speaking_bg_removed.png',

    admin_message_idle: 'images/admin-message.png',
    admin_message_speaking: 'images/admin-message.png',
  },
  sprint: {
    default_idle: ['images/Idle-SpringMode-Photoroom.png', 'images/Idle2-SprintMode-Photoroom.png'],
    default_speaking: 'images/Speaking-SprintMode-Photoroom.png',

    angry_idle: 'images/Angry-SprintMode.png',
    angry_speaking: 'images/AngrySpeaking-SprintMode.png',

    worried_idle: 'images/Worried-SprintMode-Photoroom.png',
    worried_speaking: 'images/Worried-SprintMode-Photoroom.png',

    lunch_1_idle: 'images/LunchFirstHalf-SprintMode-Photoroom.png',
    lunch_1_speaking: 'images/LunchFirstHalf-SprintMode-Photoroom.png',
    lunch_2_idle: 'images/LunchSecondHalf-SprintMode-Photoroom.png',
    lunch_2_speaking: 'images/LunchSecondHalf-SprintMode-Photoroom.png',

    end_shift_idle: 'images/EndShiftGood-SprintMode.png',
    end_shift_speaking: 'images/EndShiftGood-SprintMode.png',

    dead_idle: 'images/Dead-SprintMode.png',
    dead_speaking: 'images/Dead-SprintMode.png',

    congrats_idle: 'images/Congratulations-SprintMode.png',
    congrats_speaking: 'images/Congratulations-SprintMode.png',

    tablet_idle: 'images/Tablet-SprintMode-Photoroom.png',
    tablet_speaking: 'images/Speaking-Tablet-SprintMode-Photoroom.png',

    admin_message_idle: 'images/Tablet-SprintMode-Photoroom.png',
    admin_message_speaking: 'images/SpeakingOnMegaphone-SprintMode-Photoroom.png',
  },
};

export const COMPANION_PHRASES = {
  openIdle: [
    'Tô de olho. Você trabalha, eu faço o drama… e o lembrete.',
    'Pronto. Me chama quando quiser uma dica curta e útil (eu juro).',
    'Quer um empurrão? “Dica rápida” é meu botão de café.',
    'Se o Time Tracker estiver ligado, eu aviso antes do idle involuntário. Sem susto.',
    'Consistência primeiro. Velocidade vem como bônus — não como dívida.',
  ],

  help:
    'Eu sou o Noir. Meio terapeuta, meio fiscal do relógio.\n\nEu posso:\n- Dar dicas rápidas (sem textão)\n- Avisar quando você começa a ficar pra trás\n- Te cutucar antes de cair em Ociosidade involuntária\n- Te lembrar do básico\n\nSe eu ficar chato, você pode me esconder. Eu finjo que não doeu.',

  tips: [
    'Dica rápida: resolve → registra. O tempo some quando você deixa pra depois.',
    'Dica rápida: faz um setup padrão (sempre igual). Isso é velocidade sem correria.',
    'Dica rápida: reduz variação. Mesma ordem = menos retrabalho mental.',
    'Dica rápida: travou? Faz o “mínimo correto” e segue. Perfeccionismo atrasado é só atraso.',
  ],

  motivation: {
    funny: [
      'Um passo de cada vez. O saldo gosta de rotina (e eu também).',
      'Consistência ganha do “sprint”. Mesmo no sprint mode. Ironia? Sim. Verdade? Também.',
      'Respira. Uma conta bem feita agora vale por duas corridas depois.',
      'Você não tá atrasado, você tá “carregando recursos”. Agora executa.',
    ],
    serious: [
      'Se você tá atrás: reduz variação, não aumenta pressa.',
      'Hoje é dia de execução: menos dúvida, mais padrão.',
      'Ritmo bom é previsível. O improviso é caro.',
    ],
    angry: [
      'Bora. Menos loop mental, mais registro.',
      'Você sabe o que fazer. Executa e registra.',
      'Se travar, faz o próximo passo. Pensar demais é só pausa sem TT.',
    ],
    neutral: [
      'Mantém o padrão e segue.',
      'Sem pressa, sem erro. Um de cada vez.',
    ],
  } satisfies Record<CompanionTone, string[]>,

  shortcuts:
    'Atalho (o bom e velho):\n\n1) Setup padrão (sempre igual)\n2) Checar bloqueios\n3) Resolver\n4) Registrar\n\nSe estiver em TT: registra uma ação antes de parar pra evitar idle involuntário. Eu aviso, mas prefiro não precisar.',

  timeTrackerInfo:
    'Time Tracker:\n\n- Eu aviso antes de entrar em “Ociosidade involuntária”\n- Idle involuntário NÃO aparece no seu histórico (só admin vê)\n- Idle nunca deve travar você: registra uma ação e segue\n\nDica Noir: se você vai parar, registra algo antes. É menos dor de cabeça depois.',

  dynamic: {
    openIdle: {
      base: [
        'Tô aqui. Você trabalha, eu observo… com carinho e um pouco de julgamento.',
        'Se quiser, eu falo pouco e ajudo muito. É só clicar.',
        'Eu sou o Noir: botão de dica, botão de foco e botão de “não entra em idle sem registrar”.',
      ],
      sprint: [
        'Sprint mode ligado. Ritmo alto, cabeça fria. Combinado?',
        'Sprint mode: velocidade com controle. Sem atropelar o registro.',
      ],
      late: [
        'Último trecho do dia. Fecha pendência, registra direito e sai em paz.',
        'Fim de turno chegando. Agora é o básico bem feito, sem inventar.',
      ],
      behind: [
        'Se a meta tá te olhando torto: padrão + registro. A gente recupera sem pânico.',
        'Sem pressa. Só para de variar. Setup padrão e segue.',
      ],
      good: [
        'Hoje tá encaixando. Mantém o ritmo e não solta o registro.',
        'Boa execução. Agora é só repetir o que funciona.',
      ],
    },

    tips: {
      base: [
        'Dica rápida: resolve → registra. O tempo some quando você deixa pra depois.',
        'Dica rápida: setup padrão. Variação é imposto invisível.',
        'Dica rápida: travou? Próximo passo pequeno. Depois você refina.',
      ],
      sprint: [
        'Sprint mode: micro-checklist e vai. Perfeição é inimiga da velocidade.',
        'Sprint mode: fecha rápido, registra mais rápido ainda.',
      ],
      behind: [
        'Se tá atrás: tira fricção. Mesma ordem, mesma rotina, sem decisões extras.',
      ],
      late: [
        'Fim do dia: não coleciona pendência. Finaliza e registra antes de trocar de item.',
      ],
    },

    authWelcome: {
      signin: [
        'Bem-vindo de volta. Entra aí — eu já tô na tocaia faz tempo.',
        'Você voltou. Ótimo. Bora?',
        'Falae user! Bora fazer esse dia render?',
      ],
      signup: [
        'Bora criar sua conta. Dica: usa um usuário simples (tipo joao.silva).',
        'Cadastro rápido: nome simples e pronto. O resto a gente resolve trabalhando.',
      ],
    },

    ttIdleWarning: {
      title: 'Noir — Ociosidade involuntária',
      body: [
        'Ei — você entra em Ociosidade involuntária em {remaining}. Faz alguma coisa.',
        'Alerta elegante: em {remaining} vira Ociosidade involuntária. Acorda pra vida.',
      ],
    },

    pauseLimit: {
      over15: [
        'Essa pausa passou de 15 minutos. Vou fingir que não vi, mas não acostuma.',
        'Pausa > 15 min. Ok. Agora volta e registra antes que o relógio comece a rir.',
        'Foi passear no calçadão, né? Estourou o tempo, reage e volta pro jogo.',
        'Tomara que o Gui não olhe teu registro... Bora voltar pro trabalho.',
        'Estourou a pausa, se voce nao contar eu nao conto... Mas bora voltar pro trabalho.',
      ],
      hit15: [
        'Fechou 15 minutos de pausa. Tudo certo nada errado, vamo q vamo.',
        '15 minutos cravados. Mente descansada? Então bora.',
        '15 minutinhos, o Guilherme agradece.',
      ],
    },

    timeTracker: {
      start: {
        pausa: [
          'Pausa ativada. Vai lá — mas volta antes que eu comece a sentir saudade.',
          'Pausa. Água, respira, estica. Só não inventa de ir passear em.',
          'Fechou, vai respirar amigo, vou ficar no aguardo aqui.',
          'Se essa for a terceira pausa do dia ja sabe ne...',
          'Vai comprar o que no calcadao dessa vez?'
        ],
        almoço: [
          'Bora almoçar. Sera que a sala de descanso ta lotada hoje?',
          'Hora do rango. Prometo não contar quantos minutos você demorou…',
          'Almoço: ativado. Missão secundária: hidratação.',
          'Almocinho basico, vamos que vamos.',
          'Vai de marmita hoje ou vai no calcadao?',
          'Hora do rango, só lembra que salgado não é refeição.',
        ],
        falha_sistemica: [
          'Falha sistêmica. Ja grita o Tcharles ai.',
          'Falha sistêmica: clássico. Respira — a culpa não é sua... eu acho',
          'Sistema caiu? Beleza. Nao inventa de ir passear em',
          'Deu ruim? Coitado do Tcharles...',
        ],
        ociosidade: [
          'Ociosidade. Estoque baixo? Duvido muito.',
          'Ociosidade ativada. Nem todo mundo e rapido igual eu.',
          'Ociosidade. Tomara que seja justificada em',
          'Ociosidade. Sem comentarios...',
        ],
        processo_interno: [
          'Processo interno: Vai la "Senhor(a) importante".',
          'Processo interno ativado. Sim, isso conta como trabalho (e eu sei).',
          'Processo interno. Com quem e a reuniao dessa vez em?.',
            'Processo interno. Se abrir vaga nova na empresa eu vou ficar sabendo em',
            'Processo interno. Tomara que a reuniao nao seja com o povo da qualidade',
        ],
        daily: [
          'Daily: Guilherme pediu pra lembrar de abrir a camera, mesmo se voce nao se considera "fotogenico(a)".',
          'Daily ativada. Qual sera que vai ser o pepino do dia em?',
          'Daily. Quem sera que vai esquecer de mutar o microfone hoje?',
            'Daily. Que a qualidade tenha piedade da nossa alma',
        ],
        default: ['Time Tracker: {item}.'],
      },
      finish: {
        pausa: ['Pausa finalizada. Olha so, antes dos 15 minutos, ta devendo?.', 'Voltamos. Que rapido, isso que eh foco.', 'Pausa finalizada, muita ansiedade pouco foco... nao pera.'],
        almoço: ['Almoço finalizado. Se voce nao passou de uma hora ou voce mentiu ou a sala de descanso ta cheia.', 'Bem-vindo(a) de volta. Agora sim: barriga cheia, sono chegando, hora de produzir.', 'Almoço encerrado. Passeou bastante?', 'Almoço finalizado. Comeu mesmo ou foi resolver B.O?'],
        falha_sistemica: ['Falha sistêmica encerrada. Eita que o menino Tcharles ta agil.', 'Voltou. Agora finge que foi tudo “planejado”.', 'Falha sistêmica finalizada. Tomara que o sistema nao caia denovo...', 'Falha sistêmica encerrada. Ta devendo um chocolate pro Tcharles.'],
        ociosidade: ['Ociosidade finalizada. Eeeeeeeita como trabalha.', 'Bora voltar. O relógio tava ganhando de você.', 'Ociosidade encerrada. Vamos ver se agora vai.', 'Ociosidade finalizada. Trabalhou bastante na ociosidade ne...'],
        processo_interno: ['Processo interno finalizado. Como foi a reuniao?', 'Encerrado. Tomara que tenha dado tudo certo em...', 'Acabou sua reuniao ultra-importante? Vamos voltar ao trabalho.', 'Processo interno finalizado. Espero que tenha convencido todo mundo.'],
        daily: ['Daily finalizada. Agora sim: trabalhar de verdade.', 'Reunião encerrada. Voce tava fazendo conta na daily ne??.', 'Daily finalizada. Vamos ver se agora voce produz de verdade.', 'Daily finalizada. Espero que tenha sido rapida e objetiva.....'],
        default: ['Finalizado: {item}.', 'Ok — {item} encerrado.'],
      },
    },

    account: {
      start: {
        normal: [
          'Bora. {item} • {type}.',
          'Fechado: {item} • {type}. Mete bronca.',
          'Ok — {item} • {type}. Consistência e vamo.',
        ],
        sprint: [
          'Sprint: {item} • {type}. Foco na analise, velocidade vem.',
          'Sprint ligado. {item} • {type}. Direto ao ponto, sem pular etapas pelo amor de Deus.',
        ],
        late: [
          'Último trecho: {item} • {type}. Fecha limpo e registra.',
        ],
        behind: [
          'Se tá atrás: {item} • {type}. Foco e execução sem novela.',
        ],
      },
      finish: {
        normal: [
          'Boa. Finalizado: {item} • {type}.',
          'Fechou {item} • {type}. Estica as perna e bora pra proxima.',
          'Conta encerrada: {item} • {type}. Sem drama, só consistência.',
          'Finalizou {item} • {type}. Próxima.',
        ],
        sprint: [
          'Sprint: {item} • {type} fechado. Mantém a sequência, nao para nao.',
          'Rápido e limpo. {item} • {type}. Registra e segue, mantem o fluxo e amassa a meta.',
        ],
        late: [
          'Fechou {item} • {type}. Fim do dia: E agora ou nunca em.',
        ],
      },
      meta17: {
        normal: [
          '17 contas. Meta batida. Agora é manter o padrão e fechar bonito.',
          'Meta 17/17 concluída. Excelente. Sem inventar: só consistência.',
          'Massa: 17 contas. Segue no ritmo e registra certinho.',
        ],
        sprint: [
          '17/17 no sprint mode. Isso aqui é execução com sangue frio.',
          'Meta 17/17. Aprovadissimo. Acalma a mente e relaxa o fluxo, mas nem tanto.',
          'Boa demais: 17 contas. Sprint mode é velocidade com controle.',
          '17 continhas, o Guilherme agradece',
        ],
      },
      sprintFast: [
        'Rápido (≤ 15 min). E tem gente que fala que não dá pra ser rápido e bom ao mesmo tempo...',
        'Conta rápida. Segue o baile, mas presta atenção pra não vacilar.',
        'Bom. Velocidade com controle. Foca nas etapas certinho pra não acabar com uma mensagem da Luana.',
        'Conta rápida, acordou inspirado hoje hein?',
      ],
    },

    tma: {
      perfect: ['Perfeito. Diferença perto de 0.', 'Boa! Isso aí é “meta: zero”.', 'Na mosca.'],
      warnAbove: ['Atenção: acima do TMA. Ajusta pro setup padrão pra voltar pro zero.'],
      warnBelow: ['Atenção: abaixo demais do TMA. Mantém qualidade e padrão pra voltar pro zero.'],
      midAbove: ['Um pouco acima. Dá pra puxar pro padrão.'],
      midBelow: ['Um pouco abaixo. Mantém o padrão pra não distorcer.'],
    },

    lunch: {
      start: [
        'Hora do almoço. Descansa, come e volta leve.',
        'Vai lá. Água + comida e volta no ritmo.',
        'Almoço: pausa de verdade. Depois a gente acelera com calma.',
      ],
      back: [
        'Bem-vindo de volta. Mente limpa, hora de voltar ao ritmo.',
        'Voltou. Agora é ritmo constante — sem pressa e sem drama.',
        'De volta ao jogo. Uma conta limpa por vez.',
      ],
    },

    endOfDaySoon: [
      'Tá chegando no fim do turno ({remaining}). Fecha as pendências e mantém o padrão.',
      'Fim do dia chegando ({remaining}). Prioriza consistência e registro certinho.',
      'Último trecho ({remaining}). Sem pressa: só não deixa nada paralisado.',
    ],

    shiftEnded: [
      'Turno encerrado. Se precisar, finaliza o que faltou e registra direitinho.',
      'Acabou o turno. Fecha o que estiver aberto e finaliza o dia.',
    ],

    finishWorkDay: [
      'Fechou. Bom trabalho hoje. Agora partiu casa.',
      'Dia finalizado. Amanhã a gente repete o ritmo e melhora um pouco.',
      'Encerrado. Boa. Só confere se tá tudo registrado certinho pelo amor de Deus.',
      ' Dia feito. Agora é descanso merecido.',
    ],

    kpis: {
      quotaBehind: [
        'Você tá {quotaDelta} atrás da meta agora. Sem pânico: Foca nas analises + registro e você recupera.',
        '{quotaDelta} atrás da meta. Ok. Agora é analise limpa e sem tempo pra pausa.',
      ],
      balanceFar: [
        'Seu saldo tá ficando longe de 0. Faz 2–3 contas bem padrão pra estabilizar.',
        'Saldo distorcendo. Volta pro básico: mesma ordem, menos variação, e estabiliza.',
      ],
      workdayStarted: [
        'Dia iniciado. Pegou o cafézinho? Bora fazer esse dia render.',
        'Começou. Hoje a gente faz bonito: rotina, constância e registro.',
        'Bora la, sexta feira ja ta quase ai.',
      ],
    },

    admin: {
      broadcastSent: [
        'Mensagem enviada pra geral. Agora é só esperar o caos (controlado).',
        'Foi. Broadcast enviado. Que a força do “lido” esteja com você.',
      ],
    },
  },
} as const;
