import {handleRequest} from "../core.mjs";
Deno.serve((request:Request)=>{
  const env={
    SUPABASE_URL:Deno.env.get("SUPABASE_URL")||"",
    SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",
    GROQ_API_KEY:Deno.env.get("GROQ_API_KEY")||""
  };
  return handleRequest(request,env);
});
