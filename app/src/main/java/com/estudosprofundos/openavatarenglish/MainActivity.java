package com.estudosprofundos.openavatarenglish;

import android.Manifest;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.speech.*;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.*;
import android.widget.*;
import java.text.Normalizer;
import java.util.*;

public class MainActivity extends Activity implements RecognitionListener, TextToSpeech.OnInitListener {
    private static final int MIC_PERMISSION = 41;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private AvatarView avatar;
    private TextView status, teacher, heard, feedback;
    private Button talk, repeat, next;
    private Spinner level;
    private int lessonIndex = 0;
    private boolean ready = false;

    private final String[][] lessons = {
        {"Hello! My name is Carla.", "How are you today?", "I am learning English.", "I like music and movies.", "Nice to meet you!"},
        {"I usually wake up in the afternoon.", "What did you do yesterday?", "I would like to improve my pronunciation.", "Could you speak more slowly, please?", "Learning a language takes patience and practice."},
        {"If I had more time, I would travel more often.", "What has been the biggest challenge in your life?", "Technology has changed the way people communicate.", "I used to be afraid of making mistakes.", "In my opinion, consistency is more important than perfection."},
        {"Although the proposal seems promising, it requires careful evaluation.", "How would you respond to an unexpected professional challenge?", "Fluency involves conveying subtle ideas with clarity and confidence.", "Had I known about the opportunity, I would have applied earlier.", "Please summarize your position and support it with a persuasive argument."}
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        buildScreen();
        tts = new TextToSpeech(this, this);
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION);
        else setupRecognizer();
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(12), dp(18), dp(16));
        root.setBackgroundColor(Color.rgb(244,247,255));

        TextView title = text("SpeakMate English", 25, Color.rgb(25,31,70));
        title.setTypeface(null, Typeface.BOLD); title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(-1, dp(42)));

        avatar = new AvatarView();
        root.addView(avatar, new LinearLayout.LayoutParams(-1, dp(250)));

        status = text("Preparando professora…", 14, Color.rgb(82,89,125));
        status.setGravity(Gravity.CENTER); root.addView(status);

        LinearLayout selector = new LinearLayout(this);
        selector.setGravity(Gravity.CENTER_VERTICAL);
        selector.addView(text("Nível: ", 16, Color.DKGRAY));
        level = new Spinner(this);
        level.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
            new String[]{"Iniciante A1", "Intermediário A2–B1", "Avançado B2", "Fluente C1–C2"}));
        selector.addView(level, new LinearLayout.LayoutParams(0, dp(52), 1));
        root.addView(selector);

        teacher = card("Professora: escolha seu nível e toque em Próxima frase.", 17, Color.rgb(28,38,91));
        heard = card("Você: —", 16, Color.rgb(52,62,92));
        feedback = card("Correção: aguardando sua fala.", 15, Color.rgb(35,112,73));
        root.addView(teacher); root.addView(heard); root.addView(feedback);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.CENTER); buttons.setPadding(0, dp(10), 0, 0);
        repeat = button("🔊 OUVIR", Color.rgb(74,94,180));
        talk = button("🎤 FALAR", Color.rgb(20,145,100));
        next = button("PRÓXIMA ➜", Color.rgb(108,78,210));
        buttons.addView(repeat, new LinearLayout.LayoutParams(0, dp(58), 1));
        buttons.addView(talk, new LinearLayout.LayoutParams(0, dp(58), 1));
        buttons.addView(next, new LinearLayout.LayoutParams(0, dp(58), 1));
        root.addView(buttons);

        repeat.setOnClickListener(v -> speak(currentPhrase()));
        talk.setOnClickListener(v -> listen());
        next.setOnClickListener(v -> {
            lessonIndex++;
            teacher.setText("Professora: " + currentPhrase());
            heard.setText("Você: —");
            feedback.setText("Correção: ouça e depois repita a frase.");
            speak(currentPhrase());
        });
        level.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            public void onItemSelected(android.widget.AdapterView<?> p, View v, int pos, long id) {
                lessonIndex = 0;
                teacher.setText("Professora: " + currentPhrase());
                feedback.setText("Correção: ouça e depois repita a frase.");
                if (ready) speak(currentPhrase());
            }
            public void onNothingSelected(android.widget.AdapterView<?> p) {}
        });
        setContentView(root);
    }

    private TextView text(String s, int size, int color) {
        TextView v = new TextView(this); v.setText(s); v.setTextSize(size); v.setTextColor(color);
        v.setPadding(dp(8), dp(6), dp(8), dp(6)); return v;
    }
    private TextView card(String s, int size, int color) {
        TextView v = text(s, size, color);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE); bg.setCornerRadius(dp(14)); bg.setStroke(dp(1), Color.rgb(220,226,242));
        v.setBackground(bg); v.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(68)); lp.setMargins(0, dp(5), 0, 0);
        v.setLayoutParams(lp); return v;
    }
    private Button button(String s, int color) {
        Button b = new Button(this); b.setText(s); b.setTextColor(Color.WHITE); b.setTextSize(12);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(color); bg.setCornerRadius(dp(12));
        b.setBackground(bg); return b;
    }

    private String currentPhrase() {
        String[] group = lessons[level == null ? 0 : level.getSelectedItemPosition()];
        return group[Math.floorMod(lessonIndex, group.length)];
    }

    @Override public void onInit(int result) {
        if (result == TextToSpeech.SUCCESS) {
            int language = tts.setLanguage(Locale.US);
            tts.setSpeechRate(0.88f); tts.setPitch(1.03f);
            ready = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                public void onStart(String id) { runOnUiThread(() -> { avatar.speaking(true); status.setText("A professora está falando…"); }); }
                public void onDone(String id) { runOnUiThread(() -> { avatar.speaking(false); status.setText("Toque em FALAR e repita."); }); }
                public void onError(String id) { runOnUiThread(() -> { avatar.speaking(false); status.setText("Não foi possível reproduzir a voz."); }); }
            });
            runOnUiThread(() -> {
                status.setText(ready ? "Pronta para estudar — não precisa de servidor." : "Instale uma voz em inglês nas configurações do Android.");
                teacher.setText("Professora: " + currentPhrase());
            });
        }
    }

    private void setupRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            status.setText("O reconhecimento de voz não está disponível neste celular."); return;
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(this);
    }

    private void listen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_PERMISSION); return;
        }
        if (recognizer == null) setupRecognizer();
        if (recognizer == null) return;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak English");
        recognizer.startListening(i);
    }

    private void evaluate(String spoken) {
        String expected = currentPhrase();
        double score = similarity(clean(expected), clean(spoken));
        int percent = (int)Math.round(score * 100);
        heard.setText("Você: " + spoken);
        if (percent >= 90) {
            feedback.setText("Excelente! " + percent + "% de correspondência. Pronúncia muito clara.");
            speak("Excellent! Your pronunciation was very clear.");
        } else if (percent >= 70) {
            feedback.setText("Muito bom: " + percent + "%. Compare com: “" + expected + "”");
            speak("Very good. Listen once more. " + expected);
        } else {
            feedback.setText("Vamos tentar novamente: " + percent + "%. Diga: “" + expected + "”");
            speak("Let's try again. Listen carefully. " + expected);
        }
    }

    private String clean(String s) {
        String n = Normalizer.normalize(s.toLowerCase(Locale.US), Normalizer.Form.NFD);
        return n.replaceAll("[^a-z0-9 ]", "").replaceAll("\\s+", " ").trim();
    }
    private double similarity(String a, String b) {
        if (a.equals(b)) return 1;
        int[][] d = new int[a.length()+1][b.length()+1];
        for(int i=0;i<=a.length();i++) d[i][0]=i;
        for(int j=0;j<=b.length();j++) d[0][j]=j;
        for(int i=1;i<=a.length();i++) for(int j=1;j<=b.length();j++)
            d[i][j]=Math.min(Math.min(d[i-1][j]+1,d[i][j-1]+1),d[i-1][j-1]+(a.charAt(i-1)==b.charAt(j-1)?0:1));
        return 1.0 - (double)d[a.length()][b.length()] / Math.max(a.length(), b.length());
    }

    private void speak(String s) {
        if (!ready) { Toast.makeText(this, "A voz inglesa ainda não está pronta.", Toast.LENGTH_LONG).show(); return; }
        tts.stop(); tts.speak(s, TextToSpeech.QUEUE_FLUSH, null, "teacher");
    }

    @Override public void onReadyForSpeech(Bundle b) { status.setText("Estou ouvindo… fale em inglês."); avatar.listening(true); talk.setEnabled(false); }
    @Override public void onBeginningOfSpeech() { status.setText("Continue falando…"); }
    @Override public void onRmsChanged(float rms) { avatar.setAudioLevel(Math.max(0, Math.min(1, (rms + 2) / 10f))); }
    @Override public void onBufferReceived(byte[] b) {}
    @Override public void onEndOfSpeech() { status.setText("Analisando sua fala…"); avatar.listening(false); }
    @Override public void onError(int e) {
        avatar.listening(false); talk.setEnabled(true);
        String m = e == SpeechRecognizer.ERROR_NO_MATCH ? "Não entendi. Toque em FALAR e tente novamente." :
                   e == SpeechRecognizer.ERROR_NETWORK ? "O reconhecimento do celular precisa de internet ou do pacote de inglês off-line." :
                   "Não consegui ouvir. Tente novamente.";
        status.setText(m);
    }
    @Override public void onResults(Bundle b) {
        talk.setEnabled(true); avatar.listening(false);
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty()) evaluate(r.get(0)); else status.setText("Não entendi. Tente novamente.");
    }
    @Override public void onPartialResults(Bundle b) {
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty()) heard.setText("Você: " + r.get(0));
    }
    @Override public void onEvent(int e, Bundle b) {}

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == MIC_PERMISSION && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) setupRecognizer();
        else status.setText("Permita o microfone para praticar a pronúncia.");
    }
    @Override protected void onDestroy() {
        if (recognizer != null) recognizer.destroy();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        super.onDestroy();
    }
    private int dp(int n) { return (int)(n * getResources().getDisplayMetrics().density); }

    private class AvatarView extends View {
        private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        private float mouth = 0.10f, audio = 0; private boolean listening;
        private ValueAnimator animator;
        AvatarView() { super(MainActivity.this); setLayerType(View.LAYER_TYPE_SOFTWARE, null); }
        void speaking(boolean on) {
            if (animator != null) animator.cancel();
            if (on) {
                animator = ValueAnimator.ofFloat(0.08f, 0.48f, 0.12f, 0.34f);
                animator.setDuration(620); animator.setRepeatCount(ValueAnimator.INFINITE);
                animator.addUpdateListener(a -> { mouth=(float)a.getAnimatedValue(); invalidate(); }); animator.start();
            } else { mouth=.10f; invalidate(); }
        }
        void listening(boolean on) { listening=on; if(!on) audio=0; invalidate(); }
        void setAudioLevel(float v) { audio=v; invalidate(); }
        protected void onDraw(Canvas c) {
            super.onDraw(c); float w=getWidth(), h=getHeight(), cx=w/2;
            p.setShader(new LinearGradient(0,0,0,h,Color.rgb(31,40,91),Color.rgb(96,74,180),Shader.TileMode.CLAMP));
            c.drawRoundRect(0,0,w,h,dp(22),dp(22),p); p.setShader(null);
            p.setColor(Color.argb(45,255,255,255)); c.drawCircle(cx,h*.45f,h*.40f,p);
            p.setColor(Color.rgb(38,27,31)); c.drawOval(cx-h*.24f,h*.11f,cx+h*.24f,h*.70f,p);
            p.setColor(Color.rgb(217,158,126)); c.drawRoundRect(cx-h*.055f,h*.61f,cx+h*.055f,h*.82f,dp(20),dp(20),p);
            p.setColor(Color.rgb(238,185,151)); c.drawOval(cx-h*.205f,h*.16f,cx+h*.205f,h*.70f,p);
            p.setColor(Color.rgb(54,35,31)); c.drawArc(cx-h*.20f,h*.12f,cx+h*.20f,h*.40f,180,180,true,p);
            p.setStrokeWidth(dp(3)); p.setStrokeCap(Paint.Cap.ROUND);
            p.setColor(Color.rgb(73,47,42)); c.drawLine(cx-h*.13f,h*.38f,cx-h*.055f,h*.37f,p); c.drawLine(cx+h*.055f,h*.37f,cx+h*.13f,h*.38f,p);
            p.setColor(Color.WHITE); c.drawOval(cx-h*.13f,h*.39f,cx-h*.055f,h*.44f,p); c.drawOval(cx+h*.055f,h*.39f,cx+h*.13f,h*.44f,p);
            p.setColor(Color.rgb(63,92,84)); c.drawCircle(cx-h*.092f,h*.415f,dp(5),p); c.drawCircle(cx+h*.092f,h*.415f,dp(5),p);
            p.setColor(Color.rgb(113,70,57)); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(dp(2)); c.drawArc(cx-h*.035f,h*.44f,cx+h*.035f,h*.55f,65,60,false,p); p.setStyle(Paint.Style.FILL);
            float open = listening ? .10f + audio*.25f : mouth;
            p.setColor(Color.rgb(139,55,63)); c.drawOval(cx-h*.09f,h*.565f,cx+h*.09f,h*(.565f+open*.20f),p);
            if(open>.18f){ p.setColor(Color.rgb(65,25,31)); c.drawOval(cx-h*.065f,h*.575f,cx+h*.065f,h*(.56f+open*.18f),p); }
            p.setColor(Color.rgb(45,56,132)); Path body=new Path(); body.moveTo(cx-h*.34f,h); body.quadTo(cx-h*.29f,h*.73f,cx-h*.08f,h*.75f); body.lineTo(cx+h*.08f,h*.75f); body.quadTo(cx+h*.29f,h*.73f,cx+h*.34f,h); body.close(); c.drawPath(body,p);
            if(listening){ p.setColor(Color.rgb(78,232,174)); p.setStyle(Paint.Style.STROKE); p.setStrokeWidth(dp(5)); c.drawCircle(cx,h*.45f,h*.34f+audio*dp(8),p); p.setStyle(Paint.Style.FILL); }
        }
    }
}
