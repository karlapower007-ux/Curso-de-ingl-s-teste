import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

const token=process.env.CF_TOKEN||"";
const accountId=process.env.CF_ACCOUNT_ID||"";
if(!token||!accountId) throw new Error("missing env");

const verify=await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify",{headers:{Authorization:"Bearer "+token}}).then(r=>r.json());
if(!verify.success||!verify.result?.id) throw new Error("verify failed");
const accessKeyId=verify.result.id;
const secretAccessKey=createHash("sha256").update(token).digest("hex");
const client=new AwsClient({service:"s3",region:"auto",accessKeyId,secretAccessKey});
const bucket="consciencia-fabiano-pdfs";
const key="direct-upload-probe/"+Date.now()+".txt";
const base=`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;

const putReq=await client.sign(new Request(base+"?X-Amz-Expires=300",{method:"PUT",headers:{"Content-Type":"text/plain"}}),{aws:{signQuery:true}});
const put=await fetch(putReq.url,{method:"PUT",headers:{"Content-Type":"text/plain"},body:"ok-direct-r2"});
console.log("S3_PUT_HTTP="+put.status);
if(!put.ok) throw new Error("put failed "+put.status+" "+await put.text());

const headReq=await client.sign(new Request(base+"?X-Amz-Expires=300",{method:"HEAD"}),{aws:{signQuery:true}});
const head=await fetch(headReq.url,{method:"HEAD"});
console.log("S3_HEAD_HTTP="+head.status);
if(!head.ok) throw new Error("head failed "+head.status);

const delReq=await client.sign(new Request(base+"?X-Amz-Expires=300",{method:"DELETE"}),{aws:{signQuery:true}});
const del=await fetch(delReq.url,{method:"DELETE"});
console.log("S3_DELETE_HTTP="+del.status);
if(!del.ok) throw new Error("delete failed "+del.status);
console.log("DIRECT_R2_S3_CREDENTIALS_READY=yes");
