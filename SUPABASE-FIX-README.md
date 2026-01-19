# Guia de Correção - Problemas de Comunicação com Supabase

## 🚨 Quick Fix (Solução Rápida)

Se você só quer fazer funcionar rapidamente, siga estes passos:

1. **Execute o SQL**:
   - Abra [Supabase Dashboard](https://app.supabase.com) → SQL Editor
   - Cole todo o conteúdo de `supabase-setup.sql`
   - Clique em **Run**

2. **Reinicie o servidor da API**:
   - Settings → API → **Restart Server**

3. **Limpe cache e recarregue**:
   - No navegador: Ctrl+Shift+Delete → Limpar cache
   - Recarregue a página (Ctrl+F5)

4. **Crie um novo usuário de teste**:
   - Registre-se com um novo username/password
   - Verifique se aparece no painel de admin

5. **Se não aparecer, torne-o admin manualmente**:
   ```sql
   -- No SQL Editor do Supabase
   SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1;
   -- Copie o ID e execute:
   UPDATE public.profiles SET is_admin = true WHERE user_id = '<COLE-O-ID-AQUI>';
   ```

6. **Teste registrar uma transação**:
   - Abra o console (F12)
   - Registre uma transação
   - Verifique se aparece a mensagem: `[CloudSync] Transaction inserted successfully`

Se ainda não funcionar, leia o guia completo abaixo. 👇

---

## Problema Identificado

O sistema não estava criando automaticamente registros na tabela `profiles` quando novos usuários se cadastravam. Isso causava:

1. **Usuários não apareciam no painel de admin** - A tabela `profiles` estava vazia
2. **Transações não eram vinculadas corretamente** - Sem perfil, as transações não tinham contexto
3. **Sincronização com Supabase falhava silenciosamente**

## Correções Implementadas

### 1. Correção no AuthService (Código)

O arquivo [ng/src/app/core/services/auth.service.ts](ng/src/app/core/services/auth.service.ts) foi atualizado para criar manualmente o registro de perfil após o signup:

```typescript
// Agora cria o perfil automaticamente após o signup
if (data?.user) {
  await this.sb.supabase
    .from('profiles')
    .insert({
      user_id: data.user.id,
      username: u,
      is_admin: false,
      time_tracker_enabled: false,
      updated_at: new Date().toISOString(),
    });
}
```

### 2. Setup do Banco de Dados Supabase

Foi criado o arquivo [supabase-setup.sql](supabase-setup.sql) com toda a configuração necessária do banco de dados.

## Como Corrigir no Seu Ambiente

### Passo 1: Execute o SQL no Supabase

1. Acesse seu projeto no [Supabase Dashboard](https://app.supabase.com)
2. Vá para **SQL Editor**
3. Crie uma nova query
4. Copie todo o conteúdo do arquivo `supabase-setup.sql`
5. Cole no editor e clique em **Run**

Isso irá:
- Criar as tabelas `profiles`, `transactions`, `settings` e `broadcasts` (se não existirem)
- Configurar as políticas RLS (Row Level Security)
- Criar o trigger para auto-criação de perfis
- Criar a função RPC `enable_time_tracker`
- Configurar os índices para melhor performance

### Passo 2: Verifique as Configurações no index.html

Certifique-se de que o arquivo [ng/src/index.html](ng/src/index.html) tem as meta tags corretas:

```html
<meta name="supabase-url" content="https://SEU-PROJETO.supabase.co">
<meta name="supabase-anon-key" content="SUA-ANON-KEY-AQUI">
```

### Passo 3: Crie um Usuário Admin

Após executar o SQL e criar seu primeiro usuário através da interface:

1. Vá para **SQL Editor** no Supabase
2. Execute:

```sql
-- Encontre seu user_id
SELECT id, email, raw_user_meta_data->>'username' as username 
FROM auth.users;

-- Torne-se admin (substitua YOUR_USER_ID)
UPDATE public.profiles
SET is_admin = true
WHERE user_id = 'YOUR_USER_ID_HERE';
```

### Passo 4: Recarregue o Schema da API

No Supabase Dashboard:
1. Vá para **Settings** → **API**
2. Clique em **Restart Server** ou
3. Execute no SQL Editor: `NOTIFY pgrst, 'reload schema';`

### Passo 5: Teste a Aplicação

1. Rebuild/redeploy sua aplicação Angular
2. Limpe o cache do navegador (Ctrl+Shift+Delete)
3. Tente criar um novo usuário
4. Verifique se ele aparece no painel de admin
5. Registre uma transação e verifique se ela é salva corretamente

## Verificação de Problemas

### Abrir o Console do Navegador

Pressione **F12** ou **Ctrl+Shift+I** para abrir as DevTools e vá para a aba **Console**.

Os seguintes logs devem aparecer quando tudo está funcionando:

```
[CloudSync] Starting cloud sync for user: <user-id>
[CloudSync] Starting initial data pull for user: <user-id>
[CloudSync] Pulled settings successfully (ou "No settings found for user")
[CloudSync] Pulled X transactions successfully
[CloudSync] Subscribing to transactions realtime channel
[CloudSync] Transactions realtime channel subscribed
[CloudSync] Subscribing to settings realtime channel
[CloudSync] Settings realtime channel subscribed
```

Ao registrar uma transação:
```
[CloudSync] Transaction inserted successfully: <transaction-id>
```

### Verificar se os perfis estão sendo criados:

```sql
SELECT * FROM public.profiles;
```

### Verificar se as transações estão sendo salvas:

```sql
SELECT 
  t.id,
  t.item,
  t.type,
  t.created_at,
  p.username
FROM public.transactions t
JOIN public.profiles p ON t.user_id = p.user_id
ORDER BY t.created_at DESC
LIMIT 20;
```

### Verificar políticas RLS:

```sql
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public';
```

## Problemas Comuns

### "RPC enable_time_tracker não encontrado (HTTP 404)"

**Causa**: O schema SQL não foi executado ou o servidor não foi reiniciado.

**Solução**: 
1. Execute o `supabase-setup.sql`
2. Reinicie o servidor da API no Supabase

### "No API key found in request (HTTP 401)"

**Causa**: As meta tags no HTML de produção estão faltando.

**Solução**:
1. Verifique se o `index.html` deployado tem as meta tags
2. Faça um hard refresh (Ctrl+F5)
3. Limpe o cache do navegador

### "No API key found in request (HTTP 401)"

**Causa**: As meta tags no HTML de produção estão faltando.

**Solução**:
1. Verifique se o `index.html` deployado tem as meta tags
2. Faça um hard refresh (Ctrl+F5)
3. Limpe o cache do navegador

### Transações não aparecem no admin

**Causa**: Políticas RLS bloqueando acesso ou perfil não é admin.

**Solução**:
1. Verifique se o usuário tem `is_admin = true`
2. Confirme que as políticas RLS foram criadas corretamente

### Logs de erro no console indicando problemas de permissão

**Exemplos de erros**:
- `"new row violates row-level security policy"`
- `"permission denied for table"`

**Solução**:
1. Verifique se as políticas RLS foram criadas corretamente
2. Execute novamente as seções de POLICIES no `supabase-setup.sql`
3. Confirme que o usuário está autenticado (`auth.uid()` não é null)

### "Cannot insert transaction: no userId" ou "Cannot insert transaction: Supabase not ready"

**Causa**: O usuário não está autenticado ou o Supabase não foi inicializado.

**Solução**:
1. Verifique se as meta tags estão corretas no HTML
2. Faça logout e login novamente
3. Limpe o localStorage do navegador
4. Verifique se há erros no console sobre inicialização do Supabase

## Debug Avançado

### Monitorar Requisições de Rede

1. Abra DevTools (F12)
2. Vá para a aba **Network**
3. Filtre por `supabase`
4. Registre uma transação
5. Verifique as requisições POST para `/rest/v1/transactions`
6. Verifique o status code (deve ser 201) e o response

### Verificar Estado de Autenticação

No console do navegador, execute:

```javascript
// Verificar sessão atual
const session = await window.supabase?.auth.getSession();
console.log('Session:', session);

// Verificar usuário atual
const user = await window.supabase?.auth.getUser();
console.log('User:', user);
```

### Inspecionar Dados Locais

No console do navegador:

```javascript
// Ver todas as chaves do localStorage
console.log(Object.keys(localStorage));

// Ver dados específicos
console.log('Auth:', localStorage.getItem('sb-<project-ref>-auth-token'));
```

## Arquivos Modificados

- ✅ [ng/src/app/core/services/auth.service.ts](ng/src/app/core/services/auth.service.ts) - Corrigido signup
- ✅ [supabase-setup.sql](supabase-setup.sql) - Novo arquivo com setup completo do BD

## Próximos Passos

Após aplicar estas correções:

1. Teste criar novos usuários
2. Verifique se aparecem no painel de admin
3. Registre transações e confirme sincronização
4. Teste o realtime (mudanças devem aparecer automaticamente)
5. Teste a funcionalidade de broadcasts (admin → usuários)

## Suporte

Se ainda houver problemas:

1. Verifique os logs do console do navegador (F12)
2. Verifique os logs da API no Supabase Dashboard → Logs
3. Confirme que todas as tabelas e políticas foram criadas
4. Verifique se as credenciais no `index.html` estão corretas
