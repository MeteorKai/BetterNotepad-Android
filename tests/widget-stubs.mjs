// Only JVM boundary substitutes; no launcher, UI capture, device or user files.
export const stubs = {
  "android/content/Context.java": `package android.content;
import java.io.*; import java.util.*;
public class Context {
 public static final int MODE_PRIVATE=0; public File files;
 public static File defaultFiles; private static final Map<String,SharedPreferences> prefs=new HashMap<>();
 public Context(){files=defaultFiles;} public Context(File file){files=file;}
 public Context getApplicationContext(){return this;} public File getFilesDir(){return files;}
 public String getPackageName(){return "com.betternotepad.android";}
 public SharedPreferences getSharedPreferences(String name,int mode){return prefs.computeIfAbsent(files+name,key->new SharedPreferences());}
}`,
  "android/content/SharedPreferences.java": `package android.content; import java.util.*;
public class SharedPreferences {
 public final Map<String,String> values=new HashMap<>(); public boolean fail;
 public String getString(String key,String fallback){return values.getOrDefault(key,fallback);} public Editor edit(){return new Editor();}
 public class Editor {Map<String,String> change=new HashMap<>(); public Editor putString(String key,String value){change.put(key,value);return this;}
 public Editor remove(String key){change.put(key,null);return this;} public boolean commit(){if(fail)return false;change.forEach((k,v)->{if(v==null)values.remove(k);else values.put(k,v);});return true;} public void apply(){commit();}}
}`,
  "android/content/ComponentName.java": `package android.content;
public class ComponentName {public final String name;public ComponentName(Context c,Class<?> type){name=type.getName();}public boolean equals(Object o){return o instanceof ComponentName&&name.equals(((ComponentName)o).name);}public int hashCode(){return name.hashCode();}}
`,
  "android/content/Intent.java": `package android.content; import java.util.*;import android.net.Uri;
public class Intent {
 public static final int FLAG_ACTIVITY_CLEAR_TOP=1,FLAG_ACTIVITY_SINGLE_TOP=2;
 public Class<?> target;public String action;public Uri data;public int flags;public final Map<String,Object> extras=new HashMap<>();
 public Intent(){} public Intent(Context context,Class<?> type){target=type;}
 public Intent setAction(String value){action=value;return this;}public String getAction(){return action;}
 public Intent setData(Uri value){data=value;return this;} public Intent addFlags(int value){flags|=value;return this;}
 public Intent putExtra(String key,Object value){extras.put(key,value);return this;} public boolean hasExtra(String key){return extras.containsKey(key);}
 public void removeExtra(String key){extras.remove(key);}
 public int getIntExtra(String key,int fallback){return extras.get(key) instanceof Integer?(int)extras.get(key):fallback;}
 public boolean getBooleanExtra(String key,boolean fallback){return extras.get(key) instanceof Boolean?(boolean)extras.get(key):fallback;}
 public String getStringExtra(String key){return (String)extras.get(key);}
}`,
  "android/net/Uri.java": `package android.net; public class Uri {
 public final String value;Uri(String value){this.value=value;}public String toString(){return value;}
 public static class Builder {String value="";public Builder scheme(String text){value=text+":";return this;}public Builder authority(String text){value+="//"+text;return this;}
 public Builder appendPath(String text){value+="/"+text;return this;}public Uri build(){return new Uri(value);}}
}`,
  "android/content/BroadcastReceiver.java": `package android.content;import java.util.concurrent.atomic.*;
public class BroadcastReceiver {public static final AtomicInteger starts=new AtomicInteger(),finishes=new AtomicInteger();
 public void onReceive(Context c,Intent i){}public PendingResult goAsync(){starts.incrementAndGet();return new PendingResult();}
 public static class PendingResult{public void finish(){finishes.incrementAndGet();}}
}`,
  "android/appwidget/AppWidgetProvider.java": `package android.appwidget;import android.content.*;import android.os.Bundle;
public class AppWidgetProvider extends BroadcastReceiver {public void onUpdate(Context c,AppWidgetManager m,int[] ids){}public void onAppWidgetOptionsChanged(Context c,AppWidgetManager m,int id,Bundle options){}public void onDeleted(Context c,int[] ids){}}
`,
  "android/appwidget/AppWidgetProviderInfo.java": `package android.appwidget;import android.content.ComponentName;public class AppWidgetProviderInfo {public ComponentName provider;public AppWidgetProviderInfo(ComponentName value){provider=value;}}
`,
  "android/appwidget/AppWidgetManager.java": `package android.appwidget;import android.content.*;import android.app.PendingIntent;import android.os.Bundle;import android.widget.RemoteViews;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public class AppWidgetManager {
 public static final int INVALID_APPWIDGET_ID=0;public static final String EXTRA_APPWIDGET_ID="appWidgetId",OPTION_APPWIDGET_MIN_HEIGHT="minHeight";
 public static final AppWidgetManager instance=new AppWidgetManager();public static AppWidgetManager getInstance(Context c){return instance;}
 public final ConcurrentHashMap<Integer,AppWidgetProviderInfo> infos=new ConcurrentHashMap<>();public final ConcurrentHashMap<Integer,RemoteViews> views=new ConcurrentHashMap<>();public final ConcurrentHashMap<Integer,Bundle> options=new ConcurrentHashMap<>();
 public final AtomicInteger updates=new AtomicInteger();public boolean pinSupported=true,pinAccepted=true,registered=true,throwPin;public PendingIntent pin;public int pinRequests;public String queriedPackage;
 public java.util.List<AppWidgetProviderInfo> getInstalledProvidersForPackage(String name,Object profile){queriedPackage=name;return registered?java.util.Collections.singletonList(new AppWidgetProviderInfo(new ComponentName(new Context(),com.betternotepad.android.NoteWidgetProvider.class))):java.util.Collections.emptyList();}
 public AppWidgetProviderInfo getAppWidgetInfo(int id){return infos.get(id);}public int[] getAppWidgetIds(ComponentName provider){return infos.entrySet().stream().filter(e->provider.equals(e.getValue().provider)).mapToInt(e->e.getKey()).toArray();}
 public Bundle getAppWidgetOptions(int id){return options.computeIfAbsent(id,k->new Bundle());}
 public void updateAppWidget(int id,RemoteViews view){views.put(id,view);updates.incrementAndGet();}
 public boolean isRequestPinAppWidgetSupported(){return pinSupported;}public boolean requestPinAppWidget(ComponentName provider,Bundle extras,PendingIntent callback){pinRequests++;pin=callback;if(throwPin)throw new IllegalStateException("launcher rejected");return pinAccepted;}
}`,
  "android/app/PendingIntent.java": `package android.app;import android.content.*;
public class PendingIntent {public static final int FLAG_UPDATE_CURRENT=1,FLAG_IMMUTABLE=2,FLAG_MUTABLE=4,FLAG_ONE_SHOT=8;
 public Intent intent;public int flags;public boolean cancelled;public String kind;
 public static PendingIntent getActivity(Context c,int code,Intent i,int flags){return make("activity",i,flags);}
 public static PendingIntent getBroadcast(Context c,int code,Intent i,int flags){return make("broadcast",i,flags);}
 static PendingIntent make(String kind,Intent i,int flags){PendingIntent p=new PendingIntent();p.kind=kind;p.intent=i;p.flags=flags;return p;}
 public void cancel(){cancelled=true;}
}`,
  "android/app/Activity.java": `package android.app;import android.content.*;public class Activity extends Context {
 public static final int RESULT_OK=-1;public boolean finished;public int result;public Intent resultIntent;private Intent intent=new Intent();
 public Activity(){super();}public void runOnUiThread(Runnable work){work.run();}public void finish(){finished=true;}public void setResult(int value,Intent data){result=value;resultIntent=data;}
 protected void onResume(){}protected void onPause(){}protected void onSaveInstanceState(android.os.Bundle state){}protected void onNewIntent(Intent value){}public Intent getIntent(){return intent;}public void setIntent(Intent value){intent=value;}public boolean isDestroyed(){return false;}
}`,
  "android/os/Bundle.java": `package android.os;import java.util.*;public class Bundle {private final Map<String,Object> values=new HashMap<>();public int getInt(String key,int fallback){return values.containsKey(key)?(int)values.get(key):fallback;}public void putInt(String key,int value){values.put(key,value);}public void putString(String key,String value){values.put(key,value);}public String getString(String key){return (String)values.get(key);}public void putBoolean(String key,boolean value){values.put(key,value);}public boolean getBoolean(String key){return Boolean.TRUE.equals(values.get(key));}public void putIntArray(String key,int[] value){values.put(key,value);}public int[] getIntArray(String key){return (int[])values.get(key);}}
`,
  "android/os/Build.java": `package android.os;public class Build {public static class VERSION {public static int SDK_INT=34;}}
`,
  "android/os/Looper.java": `package android.os;public class Looper {public static Looper getMainLooper(){return new Looper();}}
`,
  "android/os/Handler.java": `package android.os;public class Handler {public Handler(Looper l){}public void post(Runnable work){work.run();}}
`,
  "android/graphics/Bitmap.java": `package android.graphics;public class Bitmap {public int sample;public boolean recycled;public Bitmap(int s){sample=s;}public void recycle(){recycled=true;}}
`,
  "android/graphics/BitmapFactory.java": `package android.graphics;import java.io.File;public class BitmapFactory {
 public static class Options {public boolean inJustDecodeBounds;public int outWidth,outHeight,inSampleSize;}
 public static Bitmap decodeFile(String path,Options o){if(!new File(path).exists())return null;if(o.inJustDecodeBounds){o.outWidth=2048;o.outHeight=1024;return null;}return new Bitmap(o.inSampleSize);}
}`,
  "android/graphics/Color.java": `package android.graphics;public class Color {public static int parseColor(String hex){return (int)Long.parseLong(hex.substring(1),16);}}
`,
  "android/graphics/Paint.java": `package android.graphics;public class Paint {public static final int ANTI_ALIAS_FLAG=1,STRIKE_THRU_TEXT_FLAG=16;}
`,
  "android/view/View.java": `package android.view;public class View {public static final int VISIBLE=0,GONE=8;}
`,
  "android/widget/RemoteViews.java": `package android.widget;import java.util.*;import android.app.PendingIntent;import android.graphics.Bitmap;
public class RemoteViews {public final int layout;public final Map<Integer,Object> text=new HashMap<>(),image=new HashMap<>(),click=new HashMap<>(),description=new HashMap<>(),color=new HashMap<>(),visible=new HashMap<>();
 public final Map<String,Integer> ints=new HashMap<>();public final List<RemoteViews> rows=new ArrayList<>();public RemoteViews(String p,int layout){this.layout=layout;}
 public void setInt(int id,String method,int value){ints.put(id+":"+method,value);}public void setTextColor(int id,int c){color.put(id,c);}public void setTextViewText(int id,CharSequence value){text.put(id,value.toString());}
 public void setOnClickPendingIntent(int id,PendingIntent p){click.put(id,p);}public void setContentDescription(int id,CharSequence text){description.put(id,text.toString());}
 public void setViewVisibility(int id,int v){visible.put(id,v);}public void setImageViewBitmap(int id,Bitmap b){image.put(id,b);}public void removeAllViews(int id){rows.clear();}public void addView(int id,RemoteViews row){rows.add(row);}
}`,
  "android/widget/Toast.java": `package android.widget;import android.content.Context;import java.util.*;public class Toast {public static final int LENGTH_LONG=1;public static final List<String> shown=new ArrayList<>();String text;public static Toast makeText(Context c,String text,int length){Toast t=new Toast();t.text=text;return t;}public void show(){shown.add(text);}}
`,
  "android/widget/Button.java": `package android.widget;public class Button extends TextView {public boolean enabled=true;public void setEnabled(boolean value){enabled=value;}}
`,
  "android/widget/ListView.java": `package android.widget;public class ListView {public boolean enabled=true;public void setEnabled(boolean value){enabled=value;}}
`,
};
