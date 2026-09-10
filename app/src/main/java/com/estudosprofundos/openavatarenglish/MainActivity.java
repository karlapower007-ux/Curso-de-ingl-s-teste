package com.estudosprofundos.openavatarenglish;

import android.Manifest;
import android.app.*;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.*;
import android.widget.*;

public class MainActivity extends Activity {
    private EditText address;
    private SharedPreferences prefs;
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs=getSharedPreferences("server",MODE_PRIVATE);
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO,Manifest.permission.CAMERA},10);
        showSetup();
    }

    private TextView label(String text,int size) {
        TextView v=new TextView(this); v.setText(text); v.setTextSize(size);
        v.setTextColor(Color.rgb(25,29,58)); v.setPadding(dp(8),dp(10),dp(8),dp(10)); return v;
    }

    private void showSetup() {
        if(web!=null){ web.destroy(); web=null; }
        LinearLayout root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(android.view.Gravity.CENTER); root.setPadding(dp(24),dp(24),dp(24),dp(24));
        root.setBackgroundColor(Color.rgb(246,247,252));
        TextView title=label("SpeakMate English",28); title.setGravity(17); root.addView(title);
        TextView desc=label("Professora virtual com OpenAvatarChat\n\nInicie o servidor no computador e informe o endereço, por exemplo:\nhttp://192.168.1.10:7860",16);
        desc.setGravity(17); root.addView(desc);
        address=new EditText(this); address.setHint("http://IP-DO-COMPUTADOR:7860");
        address.setSingleLine(true); address.setText(prefs.getString("url",""));
        root.addView(address,new LinearLayout.LayoutParams(-1,dp(58)));
        Button connect=new Button(this); connect.setText("CONECTAR À PROFESSORA");
        connect.setTextColor(Color.WHITE); connect.setBackgroundColor(Color.rgb(108,92,231));
        connect.setOnClickListener(v->connect()); root.addView(connect,new LinearLayout.LayoutParams(-1,dp(62)));
        TextView note=label("Use somente o endereço do seu próprio computador, na mesma rede Wi-Fi. O aplicativo pedirá confirmação antes de liberar câmera e microfone.",13);
        note.setGravity(17); root.addView(note); setContentView(root);
    }

    private void connect() {
        String url=address.getText().toString().trim();
        if(!url.startsWith("http://")&&!url.startsWith("https://")){
            Toast.makeText(this,"O endereço deve começar com http:// ou https://",Toast.LENGTH_LONG).show(); return;
        }
        prefs.edit().putString("url",url).apply();
        web=new WebView(this); WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(()->new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Permitir câmera e microfone?")
                    .setMessage("Confirme somente se este é o servidor OpenAvatarChat do seu computador:\n"+request.getOrigin())
                    .setPositiveButton("Permitir",(d,w)->request.grant(request.getResources()))
                    .setNegativeButton("Negar",(d,w)->request.deny())
                    .setOnCancelListener(d->request.deny()).show());
            }
        });
        web.loadUrl(url); setContentView(web);
    }

    @Override public void onBackPressed() {
        if(web!=null && web.canGoBack()) web.goBack(); else showSetup();
    }
    private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density);}
}
