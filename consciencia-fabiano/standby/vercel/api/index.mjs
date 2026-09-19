import {handleRequest} from "../../core.mjs";
export const config={runtime:"edge"};
export default function handler(request){
  const env={
    SUPABASE_URL:process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,
    GROQ_API_KEY:process.env.GROQ_API_KEY
  };
  return handleRequest(request,env);
}
