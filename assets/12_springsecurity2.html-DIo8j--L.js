import{_ as e}from"./plugin-vue_export-helper-DlAUqK2U.js";import{c as i,a as n,b as s,o as a}from"./app-BBThAt0D.js";const r="/image/spring/spring10.png",l="/image/spring/spring11.png",d="/image/spring/spring12.png",t="/image/spring/spring13.png",c="/image/spring/spring14.png",u="/image/spring/spring15.png",v="/image/spring/spring16.png",o="/image/spring/spring17.png",p="/image/spring/spring18.png",m="/image/spring/spring19.png",b="/image/spring/spring20.png",g="/image/spring/spring21.png",h="/image/spring/spring22.png",q="/image/spring/spring23.png",x={},_=s(`<h1 id="springsecurity进阶应用" tabindex="-1"><a class="header-anchor" href="#springsecurity进阶应用"><span>SpringSecurity进阶应用</span></a></h1><h2 id="一、统一认证入口" tabindex="-1"><a class="header-anchor" href="#一、统一认证入口"><span>一、统一认证入口</span></a></h2><p>目前各大网站的认证方式非常丰富：</p><ul><li>账号密码认证</li><li>手机验证码认证</li><li>扫码登录等。</li></ul><div class="hint-container info"><p class="hint-container-title">基于当前研究的Spring Security认证流程如何支持多样化的认证方式呢？</p><p><strong>1、支持账号和密码认证:</strong> 采用OAuth2协议的密码模式即可实现。</p><p><strong>2、支持手机号加验证码认证:</strong> 用户认证提交的是手机号和验证码，并不是账号和密码。</p><p><strong>3、微信扫码认证:</strong> 基于OAuth2协议与微信交互，学成在线网站向微信服务器申请到一个令牌，然后携带令牌去微信查询用户信息，查询成功则用户在学成在线项目认证通过。</p></div><p>目前我们测试通过OAuth2的密码模式，用户认证会提交账号和密码，由<code>DaoAuthenticationProvider</code>调用<code>UserDetailsService</code>的<code>loadUserByUsername()</code>方法获取<code>UserDetails</code>用户信息。在前边我们自定义了<code>UserDetailsService</code>接口实现类，通过<code>loadUserByUsername()</code>方法根据账号查询用户信息。</p><p>而不同的认证方式提交的数据不一样，比如：手机加验证码方式会提交手机号和验证码，账号密码方式会提交账号、密码、验证码。</p><p>我们可以在<code>loadUserByUsername()</code>方法上作文章，<strong>将用户原来提交的账号数据改为提交json数据</strong>，json数据可以扩展不同认证方式所提交的各种参数。</p><p>首先创建一个DTO类表示认证的参数：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Data
public class AuthParamsDto {

    private String username; //用户名
    private String password; //域  用于扩展
    private String cellphone;//手机号
    private String checkcode;//验证码
    private String checkcodekey;//验证码key
    private String authType; // 认证的类型   password:用户名密码模式类型    sms:短信模式类型
    private Map&lt;String, Object&gt; payload = new HashMap&lt;&gt;();//附加数据，作为扩展，不同认证类型可拥有不同的附加数据。如认证类型为短信时包含smsKey : sms:3d21042d054548b08477142bbca95cfa; 所有情况下都包含clientId
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>此时<code>loadUserByUsername()</code>方法可以修改如下：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Service
public class UserServiceImpl implements UserDetailsService {

    @Autowired
    XcUserMapper xcUserMapper;

    @Override
    public UserDetails loadUserByUsername(String s) throws UsernameNotFoundException {
        AuthParamsDto authParamsDto = null;
        try {
            //将认证参数转为AuthParamsDto类型
            authParamsDto = JSON.parseObject(s, AuthParamsDto.class);
        } catch (Exception e) {
            log.info(&quot;认证请求不符合项目要求:{}&quot;,s);
            throw new RuntimeException(&quot;认证请求数据格式不对&quot;);
        }
        //账号
        String username = authParamsDto.getUsername();
        XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper&lt;XcUser&gt;().eq(XcUser::getUsername, username));
        if(user==null){
            //返回空表示用户不存在
            return null;
        }
        //取出数据库存储的正确密码
        String password  =user.getPassword();
        //用户权限,如果不加报Cannot pass a null GrantedAuthority collection
        String[] authorities = {&quot;p1&quot;};
        //将user对象转json
        String userString = JSON.toJSONString(user);
        //创建UserDetails对象
        UserDetails userDetails = User.withUsername(userString).password(password).authorities(authorities).build();

        return userDetails;
    }

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>原来的<code>DaoAuthenticationProvider</code> 会进行密码校验，现在重新定义<code>DaoAuthenticationProviderCustom</code>类，重写类的<code>additionalAuthenticationChecks</code>方法。</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Component
public class DaoAuthenticationProviderCustom extends DaoAuthenticationProvider {


 @Autowired
 public void setUserDetailsService(UserDetailsService userDetailsService) {
  super.setUserDetailsService(userDetailsService);
 }


 //屏蔽密码对比
 protected void additionalAuthenticationChecks(UserDetails userDetails, UsernamePasswordAuthenticationToken authentication) throws AuthenticationException {


 }

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改WebSecurityConfig类指定daoAuthenticationProviderCustom</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Autowired
DaoAuthenticationProviderCustom daoAuthenticationProviderCustom;

@Override
protected void configure(AuthenticationManagerBuilder auth) throws Exception {
    auth.authenticationProvider(daoAuthenticationProviderCustom);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>此时可以重启认证服务，测试申请令牌接口，传入的账号信息改为json数据，如下：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>################扩展认证请求参数后######################
###密码模式
POST {{auth_host}}/auth/oauth/token?client_id=XcWebApp&amp;client_secret=XcWebApp&amp;grant_type=password&amp;username={&quot;username&quot;:&quot;stu1&quot;,&quot;authType&quot;:&quot;password&quot;,&quot;password&quot;:&quot;111111&quot;}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>经过测试发现<code>loadUserByUsername()</code>方法可以正常接收到认证请求中的json数据。有了这些认证参数我们可以定义一个认证Service接口去进行各种方式的认证。</p><p>定义用户信息，为了扩展性让它继承XcUser</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Data
public class XcUserExt extends XcUser {
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>定义认证Service 接口,不同认证方法实现类统一以<code>authType + &quot;_authservice&quot;</code>命名</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>public interface AuthService {
   XcUserExt execute(AuthParamsDto authParamsDto);

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改UserServiceImpl类，根据认证方式使用不同的认证bean,<code>loadUserByUsername()</code>修改如下,</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Service
public class UserServiceImpl implements UserDetailsService {

    @Autowired
    XcUserMapper xcUserMapper;

    @Autowired
    ApplicationContext applicationContext;

    @Override
    public UserDetails loadUserByUsername(String s) throws UsernameNotFoundException {

        AuthParamsDto authParamsDto = null;
        try {
            //将认证参数转为AuthParamsDto类型
            authParamsDto = JSON.parseObject(s, AuthParamsDto.class);
        } catch (Exception e) {
            log.info(&quot;认证请求不符合项目要求:{}&quot;,s);
            throw new RuntimeException(&quot;认证请求数据格式不对&quot;);
        }

        //认证方法
        String authType = authParamsDto.getAuthType();
        AuthService authService =  applicationContext.getBean(authType + &quot;_authservice&quot;,AuthService.class);
        XcUserExt user = authService.execute(authParamsDto);

        return getUserPrincipal(user);
    }

    public UserDetails getUserPrincipal(XcUserExt user){
        //用户权限,如果不加报Cannot pass a null GrantedAuthority collection
        String[] authorities = {&quot;p1&quot;};
        String password = user.getPassword();
        //为了安全在令牌中不放密码
        user.setPassword(null);
        //将user对象转json
        String userString = JSON.toJSONString(user);
        //创建UserDetails对象
        UserDetails userDetails = User.withUsername(userString).password(password ).authorities(authorities).build();
        return userDetails;
    }

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>到此我们基于Spring Security认证流程修改为如下：</p><figure><img src="`+r+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>上节定义了AuthService认证接口，下边实现该接口实现账号密码认证</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>// 以 authType + &quot;_authservice&quot; 命名
@Service(&quot;password_authservice&quot;)
public class PasswordAuthServiceImpl implements AuthService {

 @Autowired
 XcUserMapper xcUserMapper;

 @Autowired
 PasswordEncoder passwordEncoder;


 @Override
 public XcUserExt execute(AuthParamsDto authParamsDto) {

  //账号
  String username = authParamsDto.getUsername();
  XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper&lt;XcUser&gt;().eq(XcUser::getUsername, username));
  if(user==null){
   //返回空表示用户不存在
   throw new RuntimeException(&quot;账号不存在&quot;);
  }
  XcUserExt xcUserExt = new XcUserExt();
  BeanUtils.copyProperties(user,xcUserExt);
  //校验密码
  //取出数据库存储的正确密码
  String passwordDb  =user.getPassword();
  String passwordForm = authParamsDto.getPassword();
  boolean matches = passwordEncoder.matches(passwordForm, passwordDb);
  if(!matches){
   throw new RuntimeException(&quot;账号或密码错误&quot;);
  }
  return xcUserExt;
 }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h2 id="二、微信扫码登录" tabindex="-1"><a class="header-anchor" href="#二、微信扫码登录"><span>二、微信扫码登录</span></a></h2><h3 id="_1、-接入规范" tabindex="-1"><a class="header-anchor" href="#_1、-接入规范"><span>1、 接入规范</span></a></h3><h4 id="_1-接入流程" tabindex="-1"><a class="header-anchor" href="#_1-接入流程"><span>1）接入流程</span></a></h4><p>微信扫码登录基于OAuth2协议的授权码模式，<a href="https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html" target="_blank" rel="noopener noreferrer">接口文档</a></p><p>流程如下：</p><figure><img src="`+l+'" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>第三方应用获取access_token令牌后即可请求微信获取用户的信息，成功获取到用户的信息表示用户在第三方应用认证成功。</p><h4 id="_2-请求获取授权码" tabindex="-1"><a class="header-anchor" href="#_2-请求获取授权码"><span>2）请求获取授权码</span></a></h4><p>第三方使用网站应用授权登录前请注意已获取相应网页授权作用域（scope=snsapi_login），则可以通过在 PC 端打开以下链接<code>https://open.weixin.qq.com/connect/qrconnect?appid=APPID&amp;redirect_uri=REDIRECT_URI&amp;response_type=code&amp;scope=SCOPE&amp;state=STATE#wechat_redirect</code>若提示“该链接无法访问”，请检查参数是否填写错误，如<code>redirect_uri</code>的域名与审核时填写的授权域名不一致或 scope 不为snsapi_login。</p><p><strong>参数说明</strong></p><figure><img src="'+d+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p><strong>返回说明</strong></p><p><strong>用户允许授权后</strong>，将会重定向到redirect_uri的网址上，并且带上 code 和state参数</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>redirect_uri?code=CODE&amp;state=STATE
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p>若用户禁止授权，则不会发生重定向。</p><p>为了满足网站更定制化的需求，我们还提供了第二种获取 code 的方式，支持网站将微信登录二维码内嵌到自己页面中，用户使用微信扫码授权后通过 JS 将code返回给网站。 JS微信登录主要用途：网站希望用户在网站内就能完成登录，无需跳转到微信域下登录后再返回，提升微信登录的流畅性与成功率。 网站内嵌二维码微信登录 JS 实现办法：</p><p><strong>步骤1：</strong> 在页面中先引入如下 JS 文件（支持https）：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>http://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><p><strong>步骤2：</strong> 在需要使用微信登录的地方实例以下 JS 对象：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code> var obj = new WxLogin({
 self_redirect:true,
 id:&quot;login_container&quot;, 
 appid: &quot;&quot;, 
 scope: &quot;&quot;, 
 redirect_uri: &quot;&quot;,
  state: &quot;&quot;,
 style: &quot;&quot;,
 href: &quot;&quot;
 });
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><figure><img src="`+t+'" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><figure><img src="'+c+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><h4 id="_3-通过-code-获取access-token" tabindex="-1"><a class="header-anchor" href="#_3-通过-code-获取access-token"><span>3）通过 code 获取access_token</span></a></h4><p>通过 code 获取access_token</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>https://api.weixin.qq.com/sns/oauth2/access_token?appid=APPID&amp;secret=SECRET&amp;code=CODE&amp;grant_type=authorization_code
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><figure><img src="`+u+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p><strong>返回说明</strong></p><p>正确的返回：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>{ 
&quot;access_token&quot;:&quot;ACCESS_TOKEN&quot;, 
&quot;expires_in&quot;:7200, 
&quot;refresh_token&quot;:&quot;REFRESH_TOKEN&quot;,
&quot;openid&quot;:&quot;OPENID&quot;, 
&quot;scope&quot;:&quot;SCOPE&quot;,
&quot;unionid&quot;: &quot;o6_bmasdasdsad6_2sgVt7hMZOPfL&quot;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><figure><img src="`+v+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>错误返回样例：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>{&quot;errcode&quot;:40029,&quot;errmsg&quot;:&quot;invalid code&quot;}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div></div></div><h4 id="_4-通过access-token调用接口" tabindex="-1"><a class="header-anchor" href="#_4-通过access-token调用接口"><span>4）通过access_token调用接口</span></a></h4><p>获取access_token后，进行接口调用，有以下前提：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>access_token有效且未超时；
微信用户已授权给第三方应用帐号相应接口作用域（scope）。
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p>对于接口作用域（scope），能调用的接口有以下：</p><figure><img src="`+o+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>其中<code>snsapi_base</code>属于基础接口，若应用已拥有其它 scope 权限，则默认拥有<code>snsapi_base</code>的权限。使用<code>snsapi_base</code>可以让移动端网页授权绕过跳转授权登录页请求用户授权的动作，直接跳转第三方网页带上授权临时票据（code），但会使得用户已授权作用域（scope）仅为snsapi_base，从而导致无法获取到需要用户授权才允许获得的数据和基础功能。 接口调用方法可查阅<a href="https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html" target="_blank" rel="noopener noreferrer">《微信授权关系接口调用指南》</a></p><p>获取用户信息<a href="https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html" target="_blank" rel="noopener noreferrer">接口文档</a></p><p>接口地址</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>http请求方式: GET
https://api.weixin.qq.com/sns/userinfo?access_token=ACCESS_TOKEN&amp;openid=OPENID
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p>如下：</p><figure><img src="`+p+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>响应：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>{
&quot;openid&quot;:&quot;OPENID&quot;,
&quot;nickname&quot;:&quot;NICKNAME&quot;,
&quot;sex&quot;:1,
&quot;province&quot;:&quot;PROVINCE&quot;,
&quot;city&quot;:&quot;CITY&quot;,
&quot;country&quot;:&quot;COUNTRY&quot;,
&quot;headimgurl&quot;: &quot;https://thirdwx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/0&quot;,
&quot;privilege&quot;:[
&quot;PRIVILEGE1&quot;,
&quot;PRIVILEGE2&quot;
],
&quot;unionid&quot;: &quot; o6_bmasdasdsad6_2sgVt7hMZOPfL&quot;

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>说明如下：</p><div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre class="language-Plain"><code>参数            说明
openid        普通用户的标识，对当前开发者帐号唯一
nickname        普通用户昵称
sex            普通用户性别，1为男性，2为女性
province        普通用户个人资料填写的省份
city            普通用户个人资料填写的城市
country        国家，如中国为CN
headimgurl        用户头像，最后一个数值代表正方形头像大小（有0、46、64、96、132数值可选，0代表640*640正方形头像），用户没有头像时该项为空
privilege        用户特权信息，json数组，如微信沃卡用户为（chinaunicom）
unionid          用户统一标识。针对一个微信开放平台帐号下的应用，同一用户的 unionid 是唯一的。
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_2、接入微信登录" tabindex="-1"><a class="header-anchor" href="#_2、接入微信登录"><span>2、接入微信登录</span></a></h3><p>根据OAuth2协议授权码流程，结合本项目自身特点，分析接入微信扫码登录的流程如下：</p><figure><img src="`+m+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>本项目认证服务需要做哪些事？</p><p>1、需要定义接口接收微信下发的授权码。</p><p>2、收到授权码调用微信接口申请令牌。</p><p>3、申请到令牌调用微信获取用户信息</p><p>4、获取用户信息成功将其写入本项目用户中心数据库。</p><p>5、最后重定向到浏览器自动登录。</p><h4 id="_1-定义接口" tabindex="-1"><a class="header-anchor" href="#_1-定义接口"><span>1） 定义接口</span></a></h4><p>参考接口规范中“请求获取授权码” 定义接收微信下发的授权码接口，</p><p>定义WxLoginController类，如下：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Controller
public class WxLoginController {

    @RequestMapping(&quot;/wxLogin&quot;)
    public String wxLogin(String code, String state) throws IOException {
        log.debug(&quot;微信扫码回调,code:{},state:{}&quot;,code,state);
        //请求微信申请令牌，拿到令牌查询用户信息，将用户信息写入本项目数据库
        XcUser xcUser = new XcUser();
        //暂时硬编写，目的是调试环境
        xcUser.setUsername(&quot;t1&quot;);
        if(xcUser==null){
            return &quot;redirect:http://www.51xuecheng.cn/error.html&quot;;
        }
        String username = xcUser.getUsername();
        return &quot;redirect:http://www.51xuecheng.cn/sign.html?username=&quot;+username+&quot;&amp;authType=wx&quot;;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>定义微信认证的service</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Service(&quot;wx_authservice&quot;)
public class WxAuthServiceImpl implements AuthService {

    @Autowired
    XcUserMapper xcUserMapper;

    @Override
    public XcUserExt execute(AuthParamsDto authParamsDto) {

        //账号
        String username = authParamsDto.getUsername();
        XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper&lt;XcUser&gt;().eq(XcUser::getUsername, username));
        if(user==null){
            //返回空表示用户不存在
            throw new RuntimeException(&quot;账号不存在&quot;);
        }
        XcUserExt xcUserExt = new XcUserExt();
        BeanUtils.copyProperties(user,xcUserExt);
        return xcUserExt;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h4 id="_2-接口环境测试" tabindex="-1"><a class="header-anchor" href="#_2-接口环境测试"><span>2）接口环境测试</span></a></h4><p>接口定义好下边进行测试下，主要目的是测试接口调度的环境。</p><p>1、启动内网穿透工具</p><p>2、在/wxLogin接口中打断点</p><p>3、打开前端微信扫码页面，点击微信图标打开二维码，用户扫码，确认授权此时正常进入 /wxLogin 方法，最后跳转到http://www.51xuecheng.cn/sign.html?username=t1&amp;authType=wx。</p><h4 id="_3-接入微信认证" tabindex="-1"><a class="header-anchor" href="#_3-接入微信认证"><span>3）接入微信认证</span></a></h4><p>接下来请求微信申请令牌。</p><p>1、使用restTemplate请求微信，配置RestTemplate bean</p><p>在启动类配置restTemplate</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>    @Bean
    RestTemplate restTemplate(){
        RestTemplate restTemplate = new RestTemplate(new OkHttp3ClientHttpRequestFactory());
        return  restTemplate;
    }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>2、定义与微信认证的service接口：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>public interface WxAuthService {

    public XcUser wxAuth(String code);

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>3、下边在controller中调用wxAuth接口：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Controller
public class WxLoginController {

    @Autowired
    WxAuthService wxAuthService;

    @RequestMapping(&quot;/wxLogin&quot;)
    public String wxLogin(String code, String state) throws IOException {
        log.debug(&quot;微信扫码回调,code:{},state:{}&quot;,code,state);
        //请求微信申请令牌，拿到令牌查询用户信息，将用户信息写入本项目数据库
        XcUser xcUser = wxAuthService.wxAuth(code);
        if(xcUser==null){
            return &quot;redirect:http://www.51xuecheng.cn/error.html&quot;;
        }
        String username = xcUser.getUsername();
        return &quot;redirect:http://www.51xuecheng.cn/sign.html?username=&quot;+username+&quot;&amp;authType=wx&quot;;
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>4、在WxAuthService 的wxAuth方法中实现申请令牌、查询用户信息等内容。</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Slf4j
@Service(&quot;wx_authservice&quot;)
public class WxAuthServiceImpl implements AuthService, WxAuthService {
@Autowired
XcUserMapper xcUserMapper;
@Autowired
RestTemplate restTemplate;

@Value(&quot;\${weixin.appid}&quot;)
String appid;
@Value(&quot;\${weixin.secret}&quot;)
String secret;

public XcUser wxAuth(String code){

    //收到code调用微信接口申请access_token
    Map&lt;String, String&gt; access_token_map = getAccess_token(code);
    if(access_token_map==null){
        return null;
    }
    System.out.println(access_token_map);
    String openid = access_token_map.get(&quot;openid&quot;);
    String access_token = access_token_map.get(&quot;access_token&quot;);
    //拿access_token查询用户信息
    Map&lt;String, String&gt; userinfo = getUserinfo(access_token, openid);
    if(userinfo==null){
        return null;
    }
    //添加用户到数据库
    XcUser xcUser = null;
    
    return xcUser;
}

/**
 * 申请访问令牌,响应示例
 {
 &quot;access_token&quot;:&quot;ACCESS_TOKEN&quot;,
 &quot;expires_in&quot;:7200,
 &quot;refresh_token&quot;:&quot;REFRESH_TOKEN&quot;,
 &quot;openid&quot;:&quot;OPENID&quot;,
 &quot;scope&quot;:&quot;SCOPE&quot;,
 &quot;unionid&quot;: &quot;o6_bmasdasdsad6_2sgVt7hMZOPfL&quot;
 }
*/
private Map&lt;String,String&gt; getAccess_token(String code) {

    String wxUrl_template = &quot;https://api.weixin.qq.com/sns/oauth2/access_token?appid=%s&amp;secret=%s&amp;code=%s&amp;grant_type=authorization_code&quot;;
    //请求微信地址
    String wxUrl = String.format(wxUrl_template, appid, secret, code);

    log.info(&quot;调用微信接口申请access_token, url:{}&quot;, wxUrl);

    ResponseEntity&lt;String&gt; exchange = restTemplate.exchange(wxUrl, HttpMethod.POST, null, String.class);

    String result = exchange.getBody();
    log.info(&quot;调用微信接口申请access_token: 返回值:{}&quot;, result);
    Map&lt;String,String&gt; resultMap = JSON.parseObject(result, Map.class);

    return resultMap;
}

/**获取用户信息，示例如下：
 {
 &quot;openid&quot;:&quot;OPENID&quot;,
 &quot;nickname&quot;:&quot;NICKNAME&quot;,
 &quot;sex&quot;:1,
 &quot;province&quot;:&quot;PROVINCE&quot;,
 &quot;city&quot;:&quot;CITY&quot;,
 &quot;country&quot;:&quot;COUNTRY&quot;,
 &quot;headimgurl&quot;: &quot;https://thirdwx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/0&quot;,
 &quot;privilege&quot;:[
 &quot;PRIVILEGE1&quot;,
 &quot;PRIVILEGE2&quot;
 ],
 &quot;unionid&quot;: &quot; o6_bmasdasdsad6_2sgVt7hMZOPfL&quot;
 }
*/
private Map&lt;String,String&gt; getUserinfo(String access_token,String openid) {

    String wxUrl_template = &quot;https://api.weixin.qq.com/sns/userinfo?access_token=%s&amp;openid=%s&quot;;
    //请求微信地址
    String wxUrl = String.format(wxUrl_template, access_token,openid);

    log.info(&quot;调用微信接口申请access_token, url:{}&quot;, wxUrl);

    ResponseEntity&lt;String&gt; exchange = restTemplate.exchange(wxUrl, HttpMethod.POST, null, String.class);

    //防止乱码进行转码
    String result = new     String(exchange.getBody().getBytes(StandardCharsets.ISO_8859_1),StandardCharsets.UTF_8);
    log.info(&quot;调用微信接口申请access_token: 返回值:{}&quot;, result);
    Map&lt;String,String&gt; resultMap = JSON.parseObject(result, Map.class);

    return resultMap;
}
....
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>测试获取用户信息</p><p>1、在获取用户信息处打断点</p><p>2、进入http://www.51xuecheng.cn/wxsign.html</p><p>3、手机扫码授权</p><h4 id="_4-保存用户信息" tabindex="-1"><a class="header-anchor" href="#_4-保存用户信息"><span>4）保存用户信息</span></a></h4><p>向数据库保存用户信息，如果用户不存在将其保存在数据库。</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Autowired
XcUserRoleMapper xcUserRoleMapper;

@Transactional
public XcUser addWxUser(Map userInfo_map){
    String unionid = userInfo_map.get(&quot;unionid&quot;).toString();
    //根据unionid查询数据库
    XcUser xcUser = xcUserMapper.selectOne(new LambdaQueryWrapper&lt;XcUser&gt;().eq(XcUser::getWxUnionid, unionid));
    if(xcUser!=null){
        return xcUser;
    }
    String userId = UUID.randomUUID().toString();
    xcUser = new XcUser();
    xcUser.setId(userId);
    xcUser.setWxUnionid(unionid);
    //记录从微信得到的昵称
    xcUser.setNickname(userInfo_map.get(&quot;nickname&quot;).toString());
    xcUser.setUserpic(userInfo_map.get(&quot;headimgurl&quot;).toString());
    xcUser.setName(userInfo_map.get(&quot;nickname&quot;).toString());
    xcUser.setUsername(unionid);
    xcUser.setPassword(unionid);
    xcUser.setUtype(&quot;101001&quot;);//学生类型
    xcUser.setStatus(&quot;1&quot;);//用户状态
    xcUser.setCreateTime(LocalDateTime.now());
    xcUserMapper.insert(xcUser);
    XcUserRole xcUserRole = new XcUserRole();
    xcUserRole.setId(UUID.randomUUID().toString());
    xcUserRole.setUserId(userId);
    xcUserRole.setRoleId(&quot;17&quot;);//学生角色
    xcUserRoleMapper.insert(xcUserRole);
    return xcUser;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>调用保存用户信息</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Autowired
WxAuthServiceImpl currentProxy;

public XcUser wxAuth(String code){

    //收到code调用微信接口申请access_token
    Map&lt;String, String&gt; access_token_map = getAccess_token(code);
    if(access_token_map==null){
        return null;
    }
    System.out.println(access_token_map);
    String openid = access_token_map.get(&quot;openid&quot;);
    String access_token = access_token_map.get(&quot;access_token&quot;);
    //拿access_token查询用户信息
    Map&lt;String, String&gt; userinfo = getUserinfo(access_token, openid);
    if(userinfo==null){
        return null;
    }
    //将用户信息保存到数据库
    XcUser xcUser = currentProxy.addWxUser(userinfo);
    return xcUser;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>测试保存用户信息</p><p>1、在保存用户信息处打断点</p><p>2、进入http://www.51xuecheng.cn/wxsign.html</p><p>3、手机扫码授权</p><p>4、自动跳转到登录页面，提交认证成功。</p><h2 id="三、用户授权" tabindex="-1"><a class="header-anchor" href="#三、用户授权"><span>三、用户授权</span></a></h2><h3 id="_1、rbac" tabindex="-1"><a class="header-anchor" href="#_1、rbac"><span>1、RBAC</span></a></h3><p>如何实现授权？业界通常基于RBAC实现授权。</p><div class="hint-container info"><p class="hint-container-title">RBAC分为两种方式：</p><ul><li><p>基于角色的访问控制（Role-Based Access Control）</p></li><li><p>基于资源的访问控制（Resource-Based Access Control）</p></li></ul></div><ul><li><ol><li>角色的访问控制（Role-Based Access Control）是按角色进行授权，比如：主体的角色为总经理可以查询企业运营报表，查询员工工资信息等，访问控制流程如下：</li></ol></li></ul><figure><img src="`+b+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>根据上图中的判断逻辑，授权代码可表示如下：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>if(主体.hasRole(&quot;总经理角色id&quot;)){
查询工资
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>如果上图中查询工资所需要的角色变化为总经理和部门经理，此时就需要修改判断逻辑为“判断用户的角色是否是总经理或部门经理”，修改代码如下：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>if(主体.hasRole(&quot;总经理角色id&quot;) ||  主体.hasRole(&quot;部门经理角色id&quot;)){
    查询工资
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>根据上边的例子发现，当需要修改角色的权限时就需要修改授权的相关代码，系统可扩展性差。</p><ul><li><ol start="2"><li>基于资源的访问控制（Resource-Based Access Control）是按资源（或权限）进行授权，比如：用户必须具有查询工资权限才可以查询员工工资信息等，访问控制流程如下：</li></ol></li></ul><figure><img src="`+g+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>根据上图中的判断，授权代码可以表示为：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>if(主体.hasPermission(&quot;查询工资权限标识&quot;)){
    查询工资
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><div class="hint-container important"><p class="hint-container-title">优点</p><p>系统设计时定义好查询工资的权限标识，即使查询工资所需要的角色变化为总经理和部门经理也不需要修改授权代码，系统可扩展性强。</p></div><h3 id="_2、资源服务授权流程" tabindex="-1"><a class="header-anchor" href="#_2、资源服务授权流程"><span>2、资源服务授权流程</span></a></h3><p>本项目在资源服务内部进行授权，基于资源的授权模式，因为接口在资源服务，通过在接口处添加授权注解实现授权。</p><p><strong>1）首先配置nginx代理</strong></p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>   http {
    server_names_hash_bucket_size 64;
    ...
   
   #前端开发服务
  upstream uidevserver{
    server 127.0.0.1:8601 weight=10;
  } 
   server {
        listen       80;
        server_name  teacher.51xuecheng.cn;
        #charset koi8-r;
        ssi on;
        ssi_silent_errors on;
        #access_log  logs/host.access.log  main;
        #location / {
         #   alias   D:/itcast2022/xc_edu3.0/code_1/dist/;
         #   index  index.html index.htm;
        #}
        location / {
            proxy_pass   http://uidevserver;
        }

        location /api/ {
                proxy_pass http://gatewayserver/;
        } 
        
        
   }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>加载nginx 配置。</p><p><strong>2）在资源服务集成Spring Security</strong></p><p>在需要授权的接口处使用<code>@PreAuthorize(&quot;hasAuthority(&#39;权限标识符&#39;)&quot;)</code>进行控制</p><p>下边代码指定/course/list接口需要拥有<code>xc_teachmanager_course_list </code>权限。</p><div class="language-java line-numbers-mode" data-ext="java" data-title="java"><pre class="language-java"><code> 		<span class="token annotation punctuation">@PostMapping</span><span class="token punctuation">(</span><span class="token string">&quot;list&quot;</span><span class="token punctuation">)</span>
    <span class="token annotation punctuation">@PreAuthorize</span><span class="token punctuation">(</span><span class="token string">&quot;hasAuthority(&#39;xc_teachmanager_course_list&#39;)&quot;</span><span class="token punctuation">)</span>
    <span class="token keyword">public</span> <span class="token class-name">PageResult</span><span class="token generics"><span class="token punctuation">&lt;</span><span class="token class-name">CourseBase</span><span class="token punctuation">&gt;</span></span> <span class="token function">list</span><span class="token punctuation">(</span><span class="token class-name">PageParams</span> pageParams<span class="token punctuation">,</span><span class="token annotation punctuation">@RequestBody</span><span class="token punctuation">(</span>required <span class="token operator">=</span> <span class="token boolean">false</span><span class="token punctuation">)</span> 			<span class="token class-name">QueryCourseParamsDTO</span> queryCourseParamsDTO<span class="token punctuation">)</span><span class="token punctuation">{</span>
<span class="token punctuation">.</span><span class="token punctuation">.</span><span class="token punctuation">.</span>
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>设置了@PreAuthorize表示执行此方法需要授权，如果当前用户请求接口没有权限则抛出异常</p><p><code>org.springframework.security.access.AccessDeniedException: 不允许访问</code></p><p><strong>3）在统一异常处理处解析此异常信息</strong></p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@ResponseBody
@ExceptionHandler(Exception.class)
@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
public RestErrorResponse exception(Exception e) {

   log.error(&quot;【系统异常】{}&quot;,e.getMessage(),e);
   e.printStackTrace();
   if(e.getMessage().equals(&quot;不允许访问&quot;)){   # 没有权限时候的错误信息
      return new RestErrorResponse(&quot;没有操作此功能的权限&quot;);
   }
   return new RestErrorResponse(CommonError.UNKOWN_ERROR.getErrMessage());


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>4）重启资源服务进行测试</strong></p><p>使用教学机构用户登录系统，这里使用t1用户登录，账号:t1、密码：111111，登录成功，点击“教学机构”,当用户没有权限时页面提示：没有操作此功能的权限。</p><h3 id="_3、授权相关的数据模型" tabindex="-1"><a class="header-anchor" href="#_3、授权相关的数据模型"><span>3、授权相关的数据模型</span></a></h3><p>如何给用户分配权限呢？首先要学习数据模型，本项目授权相关的数据表如下：</p><figure><img src="`+h+'" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><div class="hint-container tip"><p class="hint-container-title">说明如下：</p><p><code>xc_user</code>：用户表，存储了系统用户信息，用户类型包括：学生、老师、管理员等</p><p><code>xc_role</code>：角色表，存储了系统的角色信息，学生、老师、教学管理员、系统管理员等。</p><p><code>xc_user_role</code>：用户角色表，一个用户可拥有多个角色，一个角色可被多个用户所拥有</p><p><code>xc_menu</code>:模块表，记录了菜单及菜单下的权限</p><p><code>xc_permission</code>:角色权限表，一个角色可拥有多个权限，一个权限可被多个角色所拥有</p></div><p>本项目要求掌握基于权限数据模型（5张数据表），要求在数据库中操作完成给用户分配权限、查询用户权限等需求。</p><ul><li><strong>1）查询用户所拥有的权限</strong></li></ul><p>步骤：查询用户的id-&gt;查询用户所拥有的角色-&gt;查询用户所拥有的权限</p><p>例子：</p><p><code>SELECT * FROM xc_menu WHERE id IN( SELECT menu_id FROM xc_permission WHERE role_id IN( SELECT role_id FROM xc_user_role WHERE user_id = &#39;49&#39; ) )</code></p><ul><li><p><strong>2）给用户分配权限</strong></p><ul><li><p>a）添加权限</p><p>查询用户的id-&gt;查询权限的id-&gt;查询用户的角色，如果没有角色需要先给用户指定角色-&gt;向角色权限表添加记录</p></li><li><p>b）删除用户权限</p></li></ul></li></ul><p>​ 本项目是基于角色分配权限，如果要删除用户的权限可以给用户换角色，那么新角色下的权限就是用户的权限；如果不换用户的角色可以删除角色下的权限即删除角色权限关系表相应记录，这样操作是将角色下的权限删除，属于该角色的用户都将删除此权限。</p><h3 id="_4、查询用户权限" tabindex="-1"><a class="header-anchor" href="#_4、查询用户权限"><span>4、查询用户权限</span></a></h3><p>使用Spring Security进行授权，首先在生成jwt前会查询用户的权限，如下图：</p><figure><img src="'+q+`" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure><p>接下来需要修改UserServiceImpl和PasswordAuthServiceImpl从数据库查询用户的权限。</p><p><strong>1）定义mapper接口</strong></p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>public interface XcMenuMapper extends BaseMapper&lt;XcMenu&gt; {
    @Select(&quot;SELECT    * FROM xc_menu WHERE id IN (SELECT menu_id FROM xc_permission WHERE role_id IN ( SELECT role_id FROM xc_user_role WHERE user_id = #{userId} ))&quot;)
    List&lt;XcMenu&gt; selectPermissionByUserId(@Param(&quot;userId&quot;) String userId);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p><strong>2）修改<code>PasswordAuthServiceImpl</code></strong></p><p>修改<code>UserServiceImpl</code>类的<code>getUserPrincipal</code>方法，查询权限信息</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>//查询用户身份
public UserDetails getUserPrincipal(XcUserExt user){
    String password = user.getPassword();
    //查询用户权限
    List&lt;XcMenu&gt; xcMenus = menuMapper.selectPermissionByUserId(user.getId());
    List&lt;String&gt; permissions = new ArrayList&lt;&gt;();
    if(xcMenus.size()&lt;=0){
        //用户权限,如果不加则报Cannot pass a null GrantedAuthority collection
        permissions.add(&quot;p1&quot;);
    }else{
        xcMenus.forEach(menu-&gt;{
            permissions.add(menu.getCode());
        });
    }
    //将用户权限放在XcUserExt中
    user.setPermissions(permissions);

    //为了安全在令牌中不放密码
    user.setPassword(null);
    //将user对象转json
    String userString = JSON.toJSONString(user);
    String[] authorities = permissions.toArray(new String[0]);
    UserDetails userDetails = User.withUsername(userString).password(password).authorities(authorities).build();
    return userDetails;

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_6、细粒度授权" tabindex="-1"><a class="header-anchor" href="#_6、细粒度授权"><span>6、细粒度授权</span></a></h3><h4 id="_1-什么是细粒度授权" tabindex="-1"><a class="header-anchor" href="#_1-什么是细粒度授权"><span>1）什么是细粒度授权</span></a></h4><p>细粒度授权也叫数据范围授权，即不同的用户所拥有的操作权限相同，但是能够操作的数据范围是不一样的。一个例子：用户A和用户B都是教学机构，他们都拥有“我的课程”权限，但是两个用户所查询到的数据是不一样的。</p><p>本项目有哪些细粒度授权？</p><p><strong>比如：</strong></p><ul><li><p>我的课程，教学机构只允许查询本教学机构下的课程信息。</p></li><li><p>我的选课，学生只允许查询自己所选课。</p></li></ul><p><strong>如何实现细粒度授权？</strong></p><p>细粒度授权涉及到不同的业务逻辑，通常在service层实现，根据不同的用户进行校验，根据不同的参数查询不同的数据或操作不同的数据。</p><h4 id="_5-6-2-教学机构细粒度授权" tabindex="-1"><a class="header-anchor" href="#_5-6-2-教学机构细粒度授权"><span>5.6.2 教学机构细粒度授权</span></a></h4><p>教学机构在维护课程时只允许维护本机构的课程，教学机构细粒度授权过程如下：</p><p>获取当前登录的用户身份-&gt;得到用户所属教育机构的Id-&gt;查询该教学机构下的课程信息</p><p>最终实现了用户只允许查询自己机构的课程信息。</p><p>根据公司Id查询课程，流程如下：</p><ul><li><p>a）教学机构用户登录系统，从用户身份中取出所属机构的id，在用户表中设计了company_id字段存储该用户所属的机构id.</p></li><li><p>b）接口层取出当前登录用户的身份，取出机构id</p></li><li><p>c）将机构id传入service方法。</p></li><li><p>d）service方法将机构id传入Dao方法，最终查询出本机构的课程信息。</p></li></ul><p>代码实现如下：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@ApiOperation(&quot;课程查询接口&quot;)
@PreAuthorize(&quot;hasAuthority(&#39;xc_teachmanager_course_list&#39;)&quot;)//拥有课程列表查询的权限方可访问
@PostMapping(&quot;/course/list&quot;)
public PageResult&lt;CourseBase&gt; list(PageParams pageParams, @RequestBody QueryCourseParamsDto queryCourseParams){
    //取出用户身份
    XcUser user = SecurityUtil.getUser();
    //机构id
    String companyId = user.getCompanyId();
    return courseBaseInfoService.queryCourseBaseList(Long.parseLong(companyId),pageParams,queryCourseParams);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>Service方法如下：</p><div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre class="language-Java"><code>@Override
public PageResult&lt;CourseBase&gt; queryCourseBaseList(Long companyId,PageParams pageParams, QueryCourseParamsDto queryCourseParamsDto) {

 //构建查询条件对象
 LambdaQueryWrapper&lt;CourseBase&gt; queryWrapper = new LambdaQueryWrapper&lt;&gt;();
 //机构id
 queryWrapper.eq(CourseBase::getCompanyId,companyId);
 ....
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div>`,190);function S(U,f){return a(),i("div",null,[n("more-"),_])}const y=e(x,[["render",S],["__file","12_springsecurity2.html.vue"]]),J=JSON.parse('{"path":"/posts/%E5%90%8E%E7%AB%AF/springboot/12_springsecurity2.html","title":"SpringSecurity进阶","lang":"zh-CN","frontmatter":{"title":"SpringSecurity进阶","date":"2024-08-01T00:00:00.000Z","tags":"Spring","category":"Spring","order":12,"icon":"/img/spring-security.svg","description":"SpringSecurity进阶应用 一、统一认证入口 目前各大网站的认证方式非常丰富： 账号密码认证 手机验证码认证 扫码登录等。 基于当前研究的Spring Security认证流程如何支持多样化的认证方式呢？ 1、支持账号和密码认证: 采用OAuth2协议的密码模式即可实现。 2、支持手机号加验证码认证: 用户认证提交的是手机号和验证码，并不是账...","head":[["meta",{"property":"og:url","content":"https://mister-hope.github.io/posts/%E5%90%8E%E7%AB%AF/springboot/12_springsecurity2.html"}],["meta",{"property":"og:site_name","content":"chuoer47"}],["meta",{"property":"og:title","content":"SpringSecurity进阶"}],["meta",{"property":"og:description","content":"SpringSecurity进阶应用 一、统一认证入口 目前各大网站的认证方式非常丰富： 账号密码认证 手机验证码认证 扫码登录等。 基于当前研究的Spring Security认证流程如何支持多样化的认证方式呢？ 1、支持账号和密码认证: 采用OAuth2协议的密码模式即可实现。 2、支持手机号加验证码认证: 用户认证提交的是手机号和验证码，并不是账..."}],["meta",{"property":"og:type","content":"article"}],["meta",{"property":"og:image","content":"https://mister-hope.github.io/image/spring/spring10.png"}],["meta",{"property":"og:locale","content":"zh-CN"}],["meta",{"property":"article:author","content":"chuoer47"}],["meta",{"property":"article:published_time","content":"2024-08-01T00:00:00.000Z"}],["script",{"type":"application/ld+json"},"{\\"@context\\":\\"https://schema.org\\",\\"@type\\":\\"Article\\",\\"headline\\":\\"SpringSecurity进阶\\",\\"image\\":[\\"https://mister-hope.github.io/image/spring/spring10.png\\",\\"https://mister-hope.github.io/image/spring/spring11.png\\",\\"https://mister-hope.github.io/image/spring/spring12.png\\",\\"https://mister-hope.github.io/image/spring/spring13.png\\",\\"https://mister-hope.github.io/image/spring/spring14.png\\",\\"https://mister-hope.github.io/image/spring/spring15.png\\",\\"https://mister-hope.github.io/image/spring/spring16.png\\",\\"https://mister-hope.github.io/image/spring/spring17.png\\",\\"https://mister-hope.github.io/image/spring/spring18.png\\",\\"https://mister-hope.github.io/image/spring/spring19.png\\",\\"https://mister-hope.github.io/image/spring/spring20.png\\",\\"https://mister-hope.github.io/image/spring/spring21.png\\",\\"https://mister-hope.github.io/image/spring/spring22.png\\",\\"https://mister-hope.github.io/image/spring/spring23.png\\"],\\"datePublished\\":\\"2024-08-01T00:00:00.000Z\\",\\"dateModified\\":null,\\"author\\":[{\\"@type\\":\\"Person\\",\\"name\\":\\"chuoer47\\"}]}"]]},"headers":[{"level":2,"title":"一、统一认证入口","slug":"一、统一认证入口","link":"#一、统一认证入口","children":[]},{"level":2,"title":"二、微信扫码登录","slug":"二、微信扫码登录","link":"#二、微信扫码登录","children":[{"level":3,"title":"1、 接入规范","slug":"_1、-接入规范","link":"#_1、-接入规范","children":[]},{"level":3,"title":"2、接入微信登录","slug":"_2、接入微信登录","link":"#_2、接入微信登录","children":[]}]},{"level":2,"title":"三、用户授权","slug":"三、用户授权","link":"#三、用户授权","children":[{"level":3,"title":"1、RBAC","slug":"_1、rbac","link":"#_1、rbac","children":[]},{"level":3,"title":"2、资源服务授权流程","slug":"_2、资源服务授权流程","link":"#_2、资源服务授权流程","children":[]},{"level":3,"title":"3、授权相关的数据模型","slug":"_3、授权相关的数据模型","link":"#_3、授权相关的数据模型","children":[]},{"level":3,"title":"4、查询用户权限","slug":"_4、查询用户权限","link":"#_4、查询用户权限","children":[]},{"level":3,"title":"6、细粒度授权","slug":"_6、细粒度授权","link":"#_6、细粒度授权","children":[]}]}],"git":{},"readingTime":{"minutes":18.65,"words":5595},"filePathRelative":"posts/后端/springboot/12_springsecurity2.md","localizedDate":"2024年8月1日","excerpt":"<!--more--->\\n<h1>SpringSecurity进阶应用</h1>\\n<h2>一、统一认证入口</h2>\\n<p>目前各大网站的认证方式非常丰富：</p>\\n<ul>\\n<li>账号密码认证</li>\\n<li>手机验证码认证</li>\\n<li>扫码登录等。</li>\\n</ul>\\n<div class=\\"hint-container info\\">\\n<p class=\\"hint-container-title\\">基于当前研究的Spring Security认证流程如何支持多样化的认证方式呢？</p>\\n<p><strong>1、支持账号和密码认证:</strong> 采用OAuth2协议的密码模式即可实现。</p>\\n<p><strong>2、支持手机号加验证码认证:</strong> 用户认证提交的是手机号和验证码，并不是账号和密码。</p>\\n<p><strong>3、微信扫码认证:</strong> 基于OAuth2协议与微信交互，学成在线网站向微信服务器申请到一个令牌，然后携带令牌去微信查询用户信息，查询成功则用户在学成在线项目认证通过。</p>\\n</div>","autoDesc":true}');export{y as comp,J as data};
