package com.estudosprofundos.openavatarenglish;

import android.Manifest;
import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
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
    private Spinner mode, level;
    private int lessonIndex = 0, conversationTurn = 0;
    private boolean ready = false;
    private String lastTeacherText = "";

    private final String[][] lessons = {
        {"Hello! My name is Carla.", "How are you today?", "I am learning English.", "I like music and movies.", "Nice to meet you!"},
        {"I usually wake up in the afternoon.", "What did you do yesterday?", "I would like to improve my pronunciation.", "Could you speak more slowly, please?", "Learning a language takes patience and practice."},
        {"If I had more time, I would travel more often.", "What has been the biggest challenge in your life?", "Technology has changed the way people communicate.", "I used to be afraid of making mistakes.", "In my opinion, consistency is more important than perfection."},
        {"Although the proposal seems promising, it requires careful evaluation.", "How would you respond to an unexpected professional challenge?", "Fluency involves conveying subtle ideas with clarity and confidence.", "Had I known about the opportunity, I would have applied earlier.", "Please summarize your position and support it with a persuasive argument."}
    };

    private final String[][] questions = {
        {"Hello! What is your name?", "How are you today?", "Where do you live?", "What food do you like?", "Tell me about your family.", "What do you do every day?"},
        {"What do you usually do in your free time?", "What did you do yesterday?", "Why are you learning English?", "What is your favorite movie or series?", "Tell me about a place you would like to visit.", "What are your plans for tomorrow?"},
        {"What has been an important experience in your life?", "Do you think technology improves communication? Why?", "What would you do if you could travel anywhere?", "Describe a challenge you overcame.", "What habit would you like to change?", "What makes a good friend?"},
        {"What issue in society deserves more attention?", "How has technology influenced the way we learn?", "Defend an opinion that other people may disagree with.", "What qualities are essential for effective leadership?", "How would you balance professional success and personal happiness?", "Describe a decision that changed your perspective."}
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
        root.setPadding(dp(16), dp(8), dp(16), dp(12));
        root.setBackgroundColor(Color.rgb(244,247,255));

        TextView title = text("SpeakMate English", 24, Color.rgb(25,31,70));
        title.setTypeface(null, Typeface.BOLD); title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(-1, dp(38)));

        avatar = new AvatarView();
        root.addView(avatar, new LinearLayout.LayoutParams(-1, dp(220)));

        status = text("Preparando professora…", 13, Color.rgb(82,89,125));
        status.setGravity(Gravity.CENTER); root.addView(status, new LinearLayout.LayoutParams(-1, dp(30)));

        mode = new Spinner(this);
        mode.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
            new String[]{"🗣 Conversar com a professora", "🎯 Praticar e repetir frases"}));
        root.addView(row("Modo:", mode));

        level = new Spinner(this);
        level.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
            new String[]{"Iniciante A1", "Intermediário A2–B1", "Avançado B2", "Fluente C1–C2"}));
        root.addView(row("Nível:", level));

        teacher = card("Professora: preparando a conversa…", 16, Color.rgb(28,38,91));
        heard = card("Você: —", 15, Color.rgb(52,62,92));
        feedback = card("Correção: aguardando sua fala.", 14, Color.rgb(35,112,73));
        root.addView(teacher); root.addView(heard); root.addView(feedback);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setGravity(Gravity.CENTER); buttons.setPadding(0, dp(8), 0, 0);
        repeat = button("🔊 OUVIR", Color.rgb(74,94,180));
        talk = button("🎤 RESPONDER", Color.rgb(20,145,100));
        next = button("PRÓXIMA ➜", Color.rgb(108,78,210));
        buttons.addView(repeat, new LinearLayout.LayoutParams(0, dp(55), 1));
        buttons.addView(talk, new LinearLayout.LayoutParams(0, dp(55), 1));
        buttons.addView(next, new LinearLayout.LayoutParams(0, dp(55), 1));
        root.addView(buttons);

        repeat.setOnClickListener(v -> speak(lastTeacherText));
        talk.setOnClickListener(v -> listen());
        next.setOnClickListener(v -> advance());
        android.widget.AdapterView.OnItemSelectedListener change = new android.widget.AdapterView.OnItemSelectedListener() {
            public void onItemSelected(android.widget.AdapterView<?> p, View v, int pos, long id) { resetMode(); }
            public void onNothingSelected(android.widget.AdapterView<?> p) {}
        };
        mode.setOnItemSelectedListener(change);
        level.setOnItemSelectedListener(change);
        setContentView(root);
    }

    private LinearLayout row(String label, Spinner spinner) {
        LinearLayout r = new LinearLayout(this); r.setGravity(Gravity.CENTER_VERTICAL);
        TextView l = text(label + " ", 15, Color.DKGRAY); l.setTypeface(null, Typeface.BOLD);
        r.addView(l); r.addView(spinner, new LinearLayout.LayoutParams(0, dp(45), 1));
        r.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(45))); return r;
    }

    private void resetMode() {
        lessonIndex = 0; conversationTurn = 0;
        heard.setText("Você: —");
        if (isConversation()) {
            lastTeacherText = question();
            teacher.setText("Professora: " + lastTeacherText);
            feedback.setText("Converse em inglês. Eu farei uma nova pergunta depois da sua resposta.");
            talk.setText("🎤 RESPONDER");
        } else {
            lastTeacherText = currentPhrase();
            teacher.setText("Professora: " + lastTeacherText);
            feedback.setText("Ouça e repita a frase para receber sua pontuação.");
            talk.setText("🎤 REPETIR");
        }
    }

    private void advance() {
        if (isConversation()) conversationTurn++; else lessonIndex++;
        heard.setText("Você: —");
        lastTeacherText = isConversation() ? question() : currentPhrase();
        teacher.setText("Professora: " + lastTeacherText);
        feedback.setText(isConversation() ? "Responda livremente em inglês." : "Ouça e repita a frase.");
        speak(lastTeacherText);
    }

    private boolean isConversation() { return mode == null || mode.getSelectedItemPosition() == 0; }
    private String currentPhrase() {
        String[] g = lessons[level == null ? 0 : level.getSelectedItemPosition()];
        return g[Math.floorMod(lessonIndex, g.length)];
    }
    private String question() {
        String[] g = questions[level == null ? 0 : level.getSelectedItemPosition()];
        return g[Math.floorMod(conversationTurn, g.length)];
    }

    private TextView text(String s, int size, int color) {
        TextView v = new TextView(this); v.setText(s); v.setTextSize(size); v.setTextColor(color);
        v.setPadding(dp(8), dp(4), dp(8), dp(4)); return v;
    }
    private TextView card(String s, int size, int color) {
        TextView v = text(s, size, color);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE); bg.setCornerRadius(dp(13)); bg.setStroke(dp(1), Color.rgb(220,226,242));
        v.setBackground(bg); v.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(67)); lp.setMargins(0, dp(4), 0, 0);
        v.setLayoutParams(lp); return v;
    }
    private Button button(String s, int color) {
        Button b = new Button(this); b.setText(s); b.setTextColor(Color.WHITE); b.setTextSize(11);
        GradientDrawable bg = new GradientDrawable(); bg.setColor(color); bg.setCornerRadius(dp(11));
        b.setBackground(bg); return b;
    }

    @Override public void onInit(int result) {
        if (result == TextToSpeech.SUCCESS) {
            int language = tts.setLanguage(Locale.US);
            tts.setSpeechRate(0.88f); tts.setPitch(1.03f);
            ready = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                public void onStart(String id) { runOnUiThread(() -> { avatar.speaking(true); status.setText("A professora está falando…"); }); }
                public void onDone(String id) { runOnUiThread(() -> { avatar.speaking(false); status.setText(isConversation() ? "Toque em RESPONDER e fale em inglês." : "Toque em REPETIR e diga a frase."); }); }
                public void onError(String id) { runOnUiThread(() -> { avatar.speaking(false); status.setText("Não foi possível reproduzir a voz."); }); }
            });
            runOnUiThread(() -> {
                status.setText(ready ? "Pronta — conversa e prática sem servidor." : "Instale uma voz em inglês nas configurações do Android.");
                resetMode();
                if (ready) speak(lastTeacherText);
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
        if (tts != null) tts.stop();
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

    private void evaluatePhrase(String spoken) {
        String expected = currentPhrase();
        int percent = (int)Math.round(similarity(clean(expected), clean(spoken)) * 100);
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

    private void handleConversation(String spoken) {
        heard.setText("Você: " + spoken);
        String correction = grammarCorrection(spoken);
        String reply = makeReply(spoken);
        conversationTurn++;
        String nextQuestion = question();
        lastTeacherText = reply + " " + nextQuestion;
        teacher.setText("Professora: " + lastTeacherText);
        feedback.setText(correction);
        speak(lastTeacherText);
    }

    private String makeReply(String spoken) {
        String s = clean(spoken);
        if (s.contains("dont know") || s.contains("do not know")) return "That's okay. Take your time.";
        if (s.contains("sad") || s.contains("tired") || s.contains("difficult")) return "I understand. Thank you for sharing that.";
        if (s.contains("happy") || s.contains("good") || s.contains("great")) return "That's wonderful to hear!";
        if (s.contains("family")) return "Your family sounds very important to you.";
        if (s.contains("english")) return "Your English will improve with regular practice.";
        if (s.contains("movie") || s.contains("series") || s.contains("music")) return "That sounds interesting. I enjoy talking about entertainment.";
        if (s.contains("travel") || s.contains("visit")) return "That sounds like a wonderful place to visit.";
        if (s.split(" ").length < 3) return "Good. Try giving me a longer answer next time.";
        return "Thank you. That was an interesting answer.";
    }

    private String grammarCorrection(String spoken) {
        String s = " " + clean(spoken) + " ";
        if (s.contains(" i am agree ")) return "Correção: diga “I agree”, sem usar “am”.";
        if (s.matches(".* i have [0-9]+ years.*")) return "Correção: para idade, diga “I am ... years old”.";
        if (s.contains(" yesterday i go ")) return "Correção: no passado, diga “Yesterday I went...”.";
        if (s.contains(" he have ")) return "Correção: diga “He has...”.";
        if (s.contains(" she have ")) return "Correção: diga “She has...”.";
        if (s.contains(" i no understand ")) return "Correção: diga “I don't understand”.";
        if (s.contains(" i am like ")) return "Correção: diga “I like...”, sem usar “am”.";
        if (s.contains(" more better ")) return "Correção: diga somente “better”, não “more better”.";
        int words = clean(spoken).isEmpty() ? 0 : clean(spoken).split(" ").length;
        if (words < 3) return "Dica: tente responder com uma frase completa.";
        return "Muito bem! Sua resposta foi compreensível. Continue falando em frases completas.";
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
        if (!ready || s == null || s.isEmpty()) {
            if (!ready) Toast.makeText(this, "A voz inglesa ainda não está pronta.", Toast.LENGTH_LONG).show();
            return;
        }
        tts.stop(); tts.speak(s, TextToSpeech.QUEUE_FLUSH, null, "teacher");
    }

    @Override public void onReadyForSpeech(Bundle b) { status.setText("Estou ouvindo… fale em inglês."); avatar.listening(true); talk.setEnabled(false); }
    @Override public void onBeginningOfSpeech() { status.setText("Continue falando…"); }
    @Override public void onRmsChanged(float rms) { avatar.setAudioLevel(Math.max(0, Math.min(1, (rms + 2) / 10f))); }
    @Override public void onBufferReceived(byte[] b) {}
    @Override public void onEndOfSpeech() { status.setText("Analisando sua fala…"); avatar.listening(false); }
    @Override public void onError(int e) {
        avatar.listening(false); talk.setEnabled(true);
        String m = e == SpeechRecognizer.ERROR_NO_MATCH ? "Não entendi. Toque no microfone e tente novamente." :
                   e == SpeechRecognizer.ERROR_NETWORK ? "O reconhecimento precisa de internet ou do pacote de inglês off-line." :
                   "Não consegui ouvir. Tente novamente.";
        status.setText(m);
    }
    @Override public void onResults(Bundle b) {
        talk.setEnabled(true); avatar.listening(false);
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty()) {
            if (isConversation()) handleConversation(r.get(0)); else evaluatePhrase(r.get(0));
        } else status.setText("Não entendi. Tente novamente.");
    }
    @Override public void onPartialResults(Bundle b) {
        ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (r != null && !r.isEmpty()) heard.setText("Você: " + r.get(0));
    }
    @Override public void onEvent(int e, Bundle b) {}

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        if (req == MIC_PERMISSION && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) setupRecognizer();
        else status.setText("Permita o microfone para conversar e praticar.");
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
            p.setShader(new LinearGradient(0,0,0,h,Color.rgb(25,34,83),Color.rgb(105,76,191),Shader.TileMode.CLAMP));
            c.drawRoundRect(0,0,w,h,dp(22),dp(22),p); p.setShader(null);
            p.setColor(Color.argb(50,255,255,255)); c.drawCircle(cx,h*.45f,h*.40f,p);
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
