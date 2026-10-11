package com.betternotepad.android;
import android.app.*;
import android.appwidget.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.util.AtomicFile;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public class WidgetFixture {
    static final String PHOTO="0123456789abcdef0123456789abcdef.jpg";
    static void check(boolean value) { if(!value) throw new AssertionError("Widget invariant failed"); }
    interface Work { void run() throws Exception; }
    static void rejects(Work work) throws Exception { try{work.run();}catch(Exception expected){return;}throw new AssertionError("Expected rejection"); }
    static JSONObject note(String id) throws Exception {
        return new JSONObject().put("id",id).put("title","中文 "+id).put("content","前文\n![图片](/images/"+PHOTO+")\n后文")
            .put("format","markdown").put("pinned",true).put("createdAt",1).put("updatedAt",2).put("tags",new JSONArray().put("工作"))
            .put("todos",new JSONArray().put(new JSONObject().put("id","task1").put("text","任务中文 🙂").put("done",false))
                .put(new JSONObject().put("id","task2").put("text","已完成").put("done",true)));
    }
    static JSONObject data() throws Exception {
        return new JSONObject().put("version",1).put("theme","dark").put("notes",new JSONArray().put(note("one")).put(note("two")))
            .put("trash",new JSONArray().put(note("bin").put("deletedAt",3)));
    }
    static AppWidgetManager manager=AppWidgetManager.instance;
    static NoteWidgetProvider provider=new NoteWidgetProvider();
    static void host(Context context,int id,int height) {
        manager.infos.put(id,new AppWidgetProviderInfo(new ComponentName(context,NoteWidgetProvider.class)));
        manager.getAppWidgetOptions(id).putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,height);
    }
    static void waitAsync() throws Exception {
        long end=System.currentTimeMillis()+5000;
        while(BroadcastReceiver.finishes.get()!=BroadcastReceiver.starts.get()&&System.currentTimeMillis()<end)Thread.sleep(5);
        check(BroadcastReceiver.finishes.get()==BroadcastReceiver.starts.get());
    }
    static void send(Context context,Intent intent) throws Exception {check(intent.target==WidgetActionReceiver.class);new WidgetActionReceiver().onReceive(context,intent);waitAsync();}
    static JSONObject read(Context context) throws Exception {return new JSONObject(NotebookStore.read(NoteWidgetProvider.file(context)));}
    static RemoteViews rendered(int id) {return manager.views.get(id);}
    static PendingIntent tap(RemoteViews view,int id){return (PendingIntent)view.click.get(id);}
    static void refresh(Context context) throws Exception {
        int before=manager.updates.get();NoteWidgetProvider.refresh(context);long end=System.currentTimeMillis()+5000;
        while(manager.updates.get()==before&&System.currentTimeMillis()<end)Thread.sleep(5);check(manager.updates.get()>before);
    }
    public static void main(String[] args) throws Exception {
        File root=Files.createTempDirectory(Paths.get(args[1]),"case-").toFile();Context.defaultFiles=root;Context context=new Context(root);
        AtomicFile file=NoteWidgetProvider.file(context);JSONObject original=data();NotebookStore.write(file,original.toString());String raw=NotebookStore.read(file);
        File imageDir=new File(root,"images");imageDir.mkdirs();Files.write(new File(imageDir,PHOTO).toPath(),new byte[]{1,2,3});
        String mode=args[0];
        try {
            if("store-cas".equals(mode)) {
                String version=NotebookStore.revision(raw);check(version.length()==64);
                NotebookStore.setTodo(file,"one","task1",true);
                JSONObject draft=new JSONObject(raw);draft.getJSONArray("notes").getJSONObject(0).put("title","旧页面文字");
                check(new JSONObject(NotebookStore.saveChecked(file,draft.toString(),version)).getBoolean("conflict"));
                check(read(context).getJSONArray("notes").getJSONObject(0).getJSONArray("todos").getJSONObject(0).getBoolean("done"));
                check(!NotebookStore.read(file).equals(draft.toString()));
                String latest=NotebookStore.read(file);JSONObject next=new JSONObject(latest);next.put("theme","light");
                JSONObject result=new JSONObject(NotebookStore.saveChecked(file,next.toString(),NotebookStore.revision(latest)));
                check(result.getBoolean("ok")&&result.getString("revision").equals(NotebookStore.revision(next.toString())));
            } else if("store-rollback".equals(mode)) {
                AtomicFile.failAll=true;rejects(()->NotebookStore.setTodo(file,"one","task1",true));check(NotebookStore.read(file).equals(raw));
                rejects(()->NotebookStore.saveChecked(file,raw,NotebookStore.revision(raw)));check(NotebookStore.read(file).equals(raw));
                check(!file.temp.exists());
            } else if("store-concurrency".equals(mode)) {
                for(int i=0;i<25;i++) {
                    NotebookStore.write(file,raw);String revision=NotebookStore.revision(raw);
                    JSONObject draft=new JSONObject(raw);draft.getJSONArray("notes").getJSONObject(0).put("content","app edit");
                    CountDownLatch start=new CountDownLatch(1);String[] result={null};Throwable[] error={null};
                    Thread app=new Thread(()->{try{start.await();result[0]=NotebookStore.saveChecked(file,draft.toString(),revision);}catch(Throwable e){error[0]=e;}});
                    Thread widget=new Thread(()->{try{start.await();NotebookStore.setTodo(file,"one","task1",true);}catch(Throwable e){error[0]=e;}});
                    app.start();widget.start();start.countDown();app.join();widget.join();check(error[0]==null);
                    JSONObject saved=read(context).getJSONArray("notes").getJSONObject(0);check(saved.getJSONArray("todos").getJSONObject(0).getBoolean("done"));
                    if(new JSONObject(result[0]).getBoolean("ok"))check(saved.getString("content").equals("app edit"));
                    else check(new JSONObject(result[0]).getBoolean("conflict")&&saved.getString("content").equals(original.getJSONArray("notes").getJSONObject(0).getString("content")));
                }
            } else if("store-metadata".equals(mode)) {
                original.put("manualOrder",true);NotebookStore.write(file,original.toString());
                NotebookStore.setTodo(file,"one","task1",true);String changed=NotebookStore.read(file);
                NotebookStore.setTodo(file,"one","task1",true);check(NotebookStore.read(file).equals(changed));
                JSONObject saved=read(context);JSONObject note=saved.getJSONArray("notes").getJSONObject(0);check(note.getLong("updatedAt")>2);
                note.put("updatedAt",2);note.getJSONArray("todos").getJSONObject(0).put("done",false);
                check(saved.toString().equals(original.toString()));
                NotebookStore.setTodo(file,"one","task1",false);check(!read(context).getJSONArray("notes").getJSONObject(0).getJSONArray("todos").getJSONObject(0).getBoolean("done"));
                rejects(()->NotebookStore.setTodo(file,"bin","task1",true));rejects(()->NotebookStore.setTodo(file,"one","removed",true));
            } else if("private-model".equals(mode)) {
                JSONObject note=note("x");check(NotebookStore.body(note).equals("前文\n\n后文"));check(NotebookStore.firstImage(note).equals(PHOTO));
                note.put("content","<script>plain</script>\n![图片](https://example.org/p.jpg)");check(NotebookStore.firstImage(note)==null);
                check(NotebookStore.body(note).contains("<script>"));note.put("title","").put("content","");check(NotebookStore.title(note).equals("任务中文 🙂"));
                note.remove("todos");check(NotebookStore.title(note).equals("无标题便签"));
                AtomicFile empty=new AtomicFile(new File(root,"empty.json"));check(new JSONObject(NotebookStore.read(empty)).getJSONArray("notes").length()==0);
            } else if("multi-render".equals(mode)) {
                host(context,10,600);host(context,20,600);NoteWidgetProvider.bind(context,10,"one");NoteWidgetProvider.bind(context,20,"two");
                provider.onUpdate(context,manager,new int[]{10,20});waitAsync();
                check(rendered(10).text.get(R.id.widget_title).equals("中文 one"));check(rendered(20).text.get(R.id.widget_title).equals("中文 two"));
                check(rendered(10).text.get(R.id.widget_body).equals("前文\n\n后文"));check(rendered(10).rows.size()==2);
                check(rendered(10).text.get(R.id.widget_status).toString().contains("1 / 2"));
                check(rendered(10).rows.get(1).ints.get(R.id.task_text+":setPaintFlags")==17);
                PendingIntent a=tap(rendered(10),R.id.widget_root),b=tap(rendered(20),R.id.widget_root);
                check(a.intent.getStringExtra(NoteWidgetProvider.NOTE_ID).equals("one")&&!a.intent.data.toString().equals(b.intent.data.toString()));
                check((a.flags&PendingIntent.FLAG_IMMUTABLE)!=0&&a.intent.target==MainActivity.class);
                check(tap(rendered(10),R.id.widget_config).intent.target==WidgetConfigActivity.class);
                Bitmap image=(Bitmap)rendered(10).image.get(R.id.widget_image);check(image.sample==8&&image.recycled);
            } else if("resize-theme".equals(mode)) {
                host(context,10,140);NoteWidgetProvider.bind(context,10,"one");provider.onAppWidgetOptionsChanged(context,manager,10,manager.getAppWidgetOptions(10));waitAsync();
                check(rendered(10).rows.size()==0);check(rendered(10).visible.get(R.id.widget_image).equals(8));
                check(rendered(10).text.get(R.id.widget_status).toString().contains("另 2 项"));
                manager.getAppWidgetOptions(10).putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,180);
                provider.onAppWidgetOptionsChanged(context,manager,10,manager.getAppWidgetOptions(10));waitAsync();check(rendered(10).rows.size()==1);
                manager.getAppWidgetOptions(10).putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,600);
                for(String theme:new String[]{"warm","light","dark"}) {
                    JSONObject next=data().put("theme",theme);NotebookStore.write(file,next.toString());
                    provider.onAppWidgetOptionsChanged(context,manager,10,manager.getAppWidgetOptions(10));waitAsync();
                    check(rendered(10).rows.size()==2);int background=rendered(10).ints.get(R.id.widget_root+":setBackgroundResource");
                    check(background==(theme.equals("dark")?R.drawable.widget_dark:theme.equals("light")?R.drawable.widget_light:R.drawable.widget_warm));
                }
            } else if("todo-click".equals(mode)) {
                host(context,10,600);host(context,20,600);NoteWidgetProvider.bind(context,10,"one");NoteWidgetProvider.bind(context,20,"one");NoteWidgetProvider.update(context,new int[]{10,20});
                Intent checked=tap(rendered(10).rows.get(0),R.id.task_check).intent;send(context,checked);String committed=NotebookStore.read(file);send(context,checked);
                check(NotebookStore.read(file).equals(committed));check(rendered(20).rows.get(0).text.get(R.id.task_check).equals("✓"));
                check(read(context).getJSONArray("notes").getJSONObject(1).getJSONArray("todos").getJSONObject(0).getBoolean("done")==false);
                send(context,tap(rendered(20).rows.get(0),R.id.task_check).intent);
                check(!read(context).getJSONArray("notes").getJSONObject(0).getJSONArray("todos").getJSONObject(0).getBoolean("done"));
            } else if("stale-targets".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");NoteWidgetProvider.update(context,new int[]{10});
                Intent old=tap(rendered(10).rows.get(0),R.id.task_check).intent;
                NoteWidgetProvider.bind(context,10,"two");NoteWidgetProvider.update(context,new int[]{10});
                check(!old.data.toString().equals(tap(rendered(10).rows.get(0),R.id.task_check).intent.data.toString()));NoteWidgetProvider.bind(context,10,"one");
                old.putExtra(NoteWidgetProvider.NOTE_ID,"two");send(context,old);check(NotebookStore.read(file).equals(raw));
                old.putExtra(NoteWidgetProvider.NOTE_ID,"one");NoteWidgetProvider.bind(context,10,"two");send(context,old);check(NotebookStore.read(file).equals(raw));
                NoteWidgetProvider.bind(context,10,"one");JSONObject next=data();next.getJSONArray("notes").getJSONObject(0).getJSONArray("todos").remove(0);NotebookStore.write(file,next.toString());
                String changed=NotebookStore.read(file);send(context,old);check(NotebookStore.read(file).equals(changed));check(!Toast.shown.isEmpty());
                manager.infos.remove(10);send(context,old);check(NotebookStore.read(file).equals(changed));
            } else if("deleted-and-restored".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");JSONObject next=data();JSONObject deleted=next.getJSONArray("notes").getJSONObject(0);
                next.getJSONArray("notes").remove(0);next.getJSONArray("trash").put(deleted.put("deletedAt",9));NotebookStore.write(file,next.toString());
                refresh(context);check(rendered(10).rows.isEmpty());check(rendered(10).text.get(R.id.widget_body).toString().contains("已删除"));
                check(tap(rendered(10),R.id.widget_root).intent.target==WidgetConfigActivity.class);check(NoteWidgetProvider.noteId(context,10).equals("one"));
                NotebookStore.write(file,raw);refresh(context);check(rendered(10).text.get(R.id.widget_title).equals("中文 one"));
            } else if("failures".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");NoteWidgetProvider.update(context,new int[]{10});Intent tap=tap(rendered(10).rows.get(0),R.id.task_check).intent;
                AtomicFile.failAll=true;send(context,tap);check(NotebookStore.read(file).equals(raw));check(!Toast.shown.isEmpty());AtomicFile.failAll=false;
                Files.write(file.base.toPath(),"{broken".getBytes("UTF-8"));send(context,tap);
                check(NotebookStore.read(file).equals("{broken"));check(rendered(10).text.get(R.id.widget_body).toString().contains("无法读取"));
                NotebookStore.write(file,raw);send(context,tap(rendered(10),R.id.widget_refresh).intent);check(rendered(10).rows.size()==2);
            } else if("bindings".equals(mode)) {
                host(context,10,600);host(context,20,600);NoteWidgetProvider.bind(context,10,"one");NoteWidgetProvider.bind(context,20,"two");
                NoteWidgetProvider.bindings(context).fail=true;rejects(()->NoteWidgetProvider.bind(context,10,"two"));check(NoteWidgetProvider.noteId(context,10).equals("one"));
                NoteWidgetProvider.bindings(context).fail=false;rejects(()->NoteWidgetProvider.bind(context,10,"bin"));rejects(()->NoteWidgetProvider.bind(context,99,"one"));
                Context again=new Context(root);check(NoteWidgetProvider.noteId(again,20).equals("two"));provider.onDeleted(context,new int[]{10});
                check(NoteWidgetProvider.noteId(context,10).isEmpty()&&NoteWidgetProvider.noteId(context,20).equals("two"));
            } else if("pin-confirmation".equals(mode)) {
                WidgetConfigActivity config=new WidgetConfigActivity(context,0,"one");config.runApply();check(!config.finished&&config.pinPending&&manager.pinRequests==1);
                check((manager.pin.flags&PendingIntent.FLAG_MUTABLE)!=0&&(manager.pin.flags&PendingIntent.FLAG_ONE_SHOT)!=0);
                check(!manager.pin.intent.hasExtra(AppWidgetManager.EXTRA_APPWIDGET_ID));
                check(NoteWidgetProvider.bindings(context).values.isEmpty());host(context,30,600);
                manager.pin.intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,30);send(context,manager.pin.intent);
                check(NoteWidgetProvider.noteId(context,30).equals("one")&&rendered(30).text.get(R.id.widget_title).equals("中文 one"));
                config.onResume();check(!config.pinPending&&config.status.text.contains("已确认添加")&&config.list.enabled);
            } else if("pin-fallback".equals(mode)) {
                manager.pinSupported=false;WidgetConfigActivity config=new WidgetConfigActivity(context,0,"one");config.runApply();check(config.fallbacks==1&&!config.finished&&manager.pinRequests==0);
                manager.pinSupported=true;manager.pinAccepted=false;config.runApply();check(config.fallbacks==2&&manager.pin.cancelled);
                manager.pinAccepted=true;Build.VERSION.SDK_INT=26;config.runApply();check((manager.pin.flags&PendingIntent.FLAG_MUTABLE)==0);check(NoteWidgetProvider.bindings(context).values.isEmpty());
            } else if("pin-not-created".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");
                WidgetConfigActivity config=new WidgetConfigActivity(context,0,"one");config.runApply();check(config.pinPending&&!config.finished&&!config.list.enabled);
                config.onResume();check(config.pinPending&&config.status.text.contains("尚未确认")&&!config.status.text.contains("已确认添加"));
                config.runApply();check(!config.pinPending&&manager.pinRequests==1&&config.list.enabled&&config.confirm.text.equals("再次请求添加"));
                config.runApply();check(config.pinPending&&manager.pinRequests==2);
                manager.pin.intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,99);send(context,manager.pin.intent);config.onResume();check(config.pinPending);
                config.runApply();manager.throwPin=true;config.runApply();check(!config.pinPending&&!config.finished&&config.status.text.contains("IllegalStateException"));
                check(NotebookStore.read(file).equals(raw));
            } else if("pin-not-registered".equals(mode)) {
                manager.registered=false;WidgetConfigActivity config=new WidgetConfigActivity(context,0,"one");config.onResume();
                check(config.status.text.contains("系统尚未识别"));config.runApply();check(manager.pinRequests==0&&!config.finished);
                check(manager.queriedPackage.equals("com.betternotepad.android"));manager.registered=true;config.onResume();
                check(config.status.text.contains("系统已识别"));config.runApply();check(manager.pinRequests==1&&config.pinPending);
                check(NotebookStore.read(file).equals(raw));
            } else if("pin-restored".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");WidgetConfigActivity config=new WidgetConfigActivity(context,0,"one");config.runApply();
                Bundle state=new Bundle();config.onSaveInstanceState(state);WidgetConfigActivity restored=new WidgetConfigActivity(context,0,"one");restored.restore(state);
                restored.onResume();check(restored.pinPending&&restored.status.text.contains("尚未确认"));
                host(context,20,600);NoteWidgetProvider.bind(context,20,"two");restored.onResume();check(restored.pinPending);
                host(context,30,600);manager.pin.intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,30);send(context,manager.pin.intent);restored.onResume();
                check(!restored.pinPending&&restored.status.text.contains("已确认添加")&&manager.pinRequests==1);
            } else if("public-private-receivers".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");NoteWidgetProvider.update(context,new int[]{10});
                Intent click=tap(rendered(10).rows.get(0),R.id.task_check).intent;
                check(click.target==WidgetActionReceiver.class&&tap(rendered(10),R.id.widget_refresh).intent.target==WidgetActionReceiver.class);
                provider.onReceive(context,click);waitAsync();check(NotebookStore.read(file).equals(raw));
                Intent pin=new Intent(context,WidgetActionReceiver.class).setAction(NoteWidgetProvider.PINNED).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,10).putExtra(NoteWidgetProvider.NOTE_ID,"two");
                provider.onReceive(context,pin);check(NoteWidgetProvider.noteId(context,10).equals("one"));
                send(context,click);check(read(context).getJSONArray("notes").getJSONObject(0).getJSONArray("todos").getJSONObject(0).getBoolean("done"));
            } else if("configuration".equals(mode)) {
                host(context,10,600);NoteWidgetProvider.bind(context,10,"one");WidgetConfigActivity config=new WidgetConfigActivity(context,10,"two");config.runApply();
                long end=System.currentTimeMillis()+5000;while(!config.finished&&System.currentTimeMillis()<end)Thread.sleep(5);
                check(config.finished&&config.result==Activity.RESULT_OK&&config.resultIntent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,0)==10);
                check(NoteWidgetProvider.noteId(context,10).equals("two")&&rendered(10).text.get(R.id.widget_title).equals("中文 two"));check(NotebookStore.read(file).equals(raw));
            } else if("launch-lifecycle".equals(mode)) {
                MainActivity main=new MainActivity();main.pendingNote="one";main.onResume();check(main.web.scripts.isEmpty());main.webReady=true;main.testNotify();
                check(main.web.scripts.size()==1&&main.web.scripts.get(0).contains("\"one\"")&&main.pendingNote==null);
                main.onPause();main.onNewIntent(new Intent().putExtra(NoteWidgetProvider.NOTE_ID,"two"));check(main.web.scripts.size()==1);main.web.handled="false";main.onResume();check(main.pendingNote.equals("two"));
                main.web.handled="true";main.testNotify();check(main.pendingNote==null);main.onNewIntent(new Intent().putExtra(NoteWidgetProvider.NOTE_ID,"\");plain"));
                check(main.web.scripts.get(main.web.scripts.size()-1).contains("\\\""));
            } else throw new AssertionError(mode);
            System.out.println("PASS "+mode);
        } finally {
            java.lang.reflect.Field executor=NoteWidgetProvider.class.getDeclaredField("WORK");executor.setAccessible(true);
            ((ExecutorService)executor.get(null)).shutdownNow();
        }
    }
}
