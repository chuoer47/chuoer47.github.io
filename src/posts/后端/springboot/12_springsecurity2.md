---
title: SpringSecurity进阶
date: 2024-08-01
tags: Spring
category: Spring
order: 12
icon: "/img/spring-security.svg"
---

<!--more--->

# SpringSecurity进阶应用

## 一、统一认证入口

目前各大网站的认证方式非常丰富：

- 账号密码认证
- 手机验证码认证
- 扫码登录等。
::: info 基于当前研究的Spring Security认证流程如何支持多样化的认证方式呢？

**1、支持账号和密码认证:** 采用OAuth2协议的密码模式即可实现。

**2、支持手机号加验证码认证:** 用户认证提交的是手机号和验证码，并不是账号和密码。

**3、微信扫码认证:** 基于OAuth2协议与微信交互，学成在线网站向微信服务器申请到一个令牌，然后携带令牌去微信查询用户信息，查询成功则用户在学成在线项目认证通过。

:::

目前我们测试通过OAuth2的密码模式，用户认证会提交账号和密码，由`DaoAuthenticationProvider`调用`UserDetailsService`的`loadUserByUsername()`方法获取`UserDetails`用户信息。在前边我们自定义了`UserDetailsService`接口实现类，通过`loadUserByUsername()`方法根据账号查询用户信息。

而不同的认证方式提交的数据不一样，比如：手机加验证码方式会提交手机号和验证码，账号密码方式会提交账号、密码、验证码。

我们可以在`loadUserByUsername()`方法上作文章，**将用户原来提交的账号数据改为提交json数据**，json数据可以扩展不同认证方式所提交的各种参数。

首先创建一个DTO类表示认证的参数：

```Java
@Data
public class AuthParamsDto {

    private String username; //用户名
    private String password; //域  用于扩展
    private String cellphone;//手机号
    private String checkcode;//验证码
    private String checkcodekey;//验证码key
    private String authType; // 认证的类型   password:用户名密码模式类型    sms:短信模式类型
    private Map<String, Object> payload = new HashMap<>();//附加数据，作为扩展，不同认证类型可拥有不同的附加数据。如认证类型为短信时包含smsKey : sms:3d21042d054548b08477142bbca95cfa; 所有情况下都包含clientId
}
```

此时`loadUserByUsername()`方法可以修改如下：

```Java
@Slf4j
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
            log.info("认证请求不符合项目要求:{}",s);
            throw new RuntimeException("认证请求数据格式不对");
        }
        //账号
        String username = authParamsDto.getUsername();
        XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper<XcUser>().eq(XcUser::getUsername, username));
        if(user==null){
            //返回空表示用户不存在
            return null;
        }
        //取出数据库存储的正确密码
        String password  =user.getPassword();
        //用户权限,如果不加报Cannot pass a null GrantedAuthority collection
        String[] authorities = {"p1"};
        //将user对象转json
        String userString = JSON.toJSONString(user);
        //创建UserDetails对象
        UserDetails userDetails = User.withUsername(userString).password(password).authorities(authorities).build();

        return userDetails;
    }

}
```

原来的`DaoAuthenticationProvider` 会进行密码校验，现在重新定义`DaoAuthenticationProviderCustom`类，重写类的`additionalAuthenticationChecks`方法。

```Java
@Slf4j
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
```

修改WebSecurityConfig类指定daoAuthenticationProviderCustom

```Java
@Autowired
DaoAuthenticationProviderCustom daoAuthenticationProviderCustom;

@Override
protected void configure(AuthenticationManagerBuilder auth) throws Exception {
    auth.authenticationProvider(daoAuthenticationProviderCustom);
}
```

此时可以重启认证服务，测试申请令牌接口，传入的账号信息改为json数据，如下：

```Plain
################扩展认证请求参数后######################
###密码模式
POST {{auth_host}}/auth/oauth/token?client_id=XcWebApp&client_secret=XcWebApp&grant_type=password&username={"username":"stu1","authType":"password","password":"111111"}
```

经过测试发现`loadUserByUsername()`方法可以正常接收到认证请求中的json数据。有了这些认证参数我们可以定义一个认证Service接口去进行各种方式的认证。

定义用户信息，为了扩展性让它继承XcUser

```Java
@Data
public class XcUserExt extends XcUser {
}
```

定义认证Service 接口,不同认证方法实现类统一以`authType + "_authservice"`命名

```Java
public interface AuthService {
   XcUserExt execute(AuthParamsDto authParamsDto);

}
```

修改UserServiceImpl类，根据认证方式使用不同的认证bean,`loadUserByUsername()`修改如下,

```Java
@Slf4j
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
            log.info("认证请求不符合项目要求:{}",s);
            throw new RuntimeException("认证请求数据格式不对");
        }

        //认证方法
        String authType = authParamsDto.getAuthType();
        AuthService authService =  applicationContext.getBean(authType + "_authservice",AuthService.class);
        XcUserExt user = authService.execute(authParamsDto);

        return getUserPrincipal(user);
    }

    public UserDetails getUserPrincipal(XcUserExt user){
        //用户权限,如果不加报Cannot pass a null GrantedAuthority collection
        String[] authorities = {"p1"};
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
```

到此我们基于Spring Security认证流程修改为如下：

![](/image/spring/spring10.png)

上节定义了AuthService认证接口，下边实现该接口实现账号密码认证

```Java
// 以 authType + "_authservice" 命名
@Service("password_authservice")
public class PasswordAuthServiceImpl implements AuthService {

 @Autowired
 XcUserMapper xcUserMapper;

 @Autowired
 PasswordEncoder passwordEncoder;


 @Override
 public XcUserExt execute(AuthParamsDto authParamsDto) {

  //账号
  String username = authParamsDto.getUsername();
  XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper<XcUser>().eq(XcUser::getUsername, username));
  if(user==null){
   //返回空表示用户不存在
   throw new RuntimeException("账号不存在");
  }
  XcUserExt xcUserExt = new XcUserExt();
  BeanUtils.copyProperties(user,xcUserExt);
  //校验密码
  //取出数据库存储的正确密码
  String passwordDb  =user.getPassword();
  String passwordForm = authParamsDto.getPassword();
  boolean matches = passwordEncoder.matches(passwordForm, passwordDb);
  if(!matches){
   throw new RuntimeException("账号或密码错误");
  }
  return xcUserExt;
 }
}
```



## 二、微信扫码登录

### 1、 接入规范

#### 1）接入流程

微信扫码登录基于OAuth2协议的授权码模式，[接口文档](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)

流程如下：

![](/image/spring/spring11.png)

第三方应用获取access_token令牌后即可请求微信获取用户的信息，成功获取到用户的信息表示用户在第三方应用认证成功。

#### 2）请求获取授权码

第三方使用网站应用授权登录前请注意已获取相应网页授权作用域（scope=snsapi_login），则可以通过在 PC 端打开以下链接` https://open.weixin.qq.com/connect/qrconnect?appid=APPID&redirect_uri=REDIRECT_URI&response_type=code&scope=SCOPE&state=STATE#wechat_redirect `若提示“该链接无法访问”，请检查参数是否填写错误，如`redirect_uri`的域名与审核时填写的授权域名不一致或 scope 不为snsapi_login。

**参数说明**

![](/image/spring/spring12.png)

**返回说明**

**用户允许授权后**，将会重定向到redirect_uri的网址上，并且带上 code 和state参数

```Plain
redirect_uri?code=CODE&state=STATE
```

若用户禁止授权，则不会发生重定向。

为了满足网站更定制化的需求，我们还提供了第二种获取 code 的方式，支持网站将微信登录二维码内嵌到自己页面中，用户使用微信扫码授权后通过 JS 将code返回给网站。 JS微信登录主要用途：网站希望用户在网站内就能完成登录，无需跳转到微信域下登录后再返回，提升微信登录的流畅性与成功率。 网站内嵌二维码微信登录 JS 实现办法：

**步骤1：** 在页面中先引入如下 JS 文件（支持https）：

```Plain
http://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js
```

**步骤2：** 在需要使用微信登录的地方实例以下 JS 对象：

```Plain
 var obj = new WxLogin({
 self_redirect:true,
 id:"login_container", 
 appid: "", 
 scope: "", 
 redirect_uri: "",
  state: "",
 style: "",
 href: ""
 });
```

 ![](/image/spring/spring13.png)

![](/image/spring/spring14.png)

#### 3）通过 code 获取access_token

通过 code 获取access_token

```Plain
https://api.weixin.qq.com/sns/oauth2/access_token?appid=APPID&secret=SECRET&code=CODE&grant_type=authorization_code
```

![](/image/spring/spring15.png)

**返回说明**

正确的返回：

```Plain
{ 
"access_token":"ACCESS_TOKEN", 
"expires_in":7200, 
"refresh_token":"REFRESH_TOKEN",
"openid":"OPENID", 
"scope":"SCOPE",
"unionid": "o6_bmasdasdsad6_2sgVt7hMZOPfL"
}
```

![](/image/spring/spring16.png)

错误返回样例：

```Plain
{"errcode":40029,"errmsg":"invalid code"}
```

#### 4）通过access_token调用接口

获取access_token后，进行接口调用，有以下前提：

```Plain
access_token有效且未超时；
微信用户已授权给第三方应用帐号相应接口作用域（scope）。
```

对于接口作用域（scope），能调用的接口有以下：

![](/image/spring/spring17.png)

 其中`snsapi_base`属于基础接口，若应用已拥有其它 scope 权限，则默认拥有`snsapi_base`的权限。使用`snsapi_base`可以让移动端网页授权绕过跳转授权登录页请求用户授权的动作，直接跳转第三方网页带上授权临时票据（code），但会使得用户已授权作用域（scope）仅为snsapi_base，从而导致无法获取到需要用户授权才允许获得的数据和基础功能。 接口调用方法可查阅[《微信授权关系接口调用指南》](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html)

获取用户信息[接口文档](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html)

接口地址

```Plain
http请求方式: GET
https://api.weixin.qq.com/sns/userinfo?access_token=ACCESS_TOKEN&openid=OPENID
```

如下：

![](/image/spring/spring18.png)

响应：

```Java
{
"openid":"OPENID",
"nickname":"NICKNAME",
"sex":1,
"province":"PROVINCE",
"city":"CITY",
"country":"COUNTRY",
"headimgurl": "https://thirdwx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/0",
"privilege":[
"PRIVILEGE1",
"PRIVILEGE2"
],
"unionid": " o6_bmasdasdsad6_2sgVt7hMZOPfL"

}
```

说明如下：

```Plain
参数            说明
openid        普通用户的标识，对当前开发者帐号唯一
nickname        普通用户昵称
sex            普通用户性别，1为男性，2为女性
province        普通用户个人资料填写的省份
city            普通用户个人资料填写的城市
country        国家，如中国为CN
headimgurl        用户头像，最后一个数值代表正方形头像大小（有0、46、64、96、132数值可选，0代表640*640正方形头像），用户没有头像时该项为空
privilege        用户特权信息，json数组，如微信沃卡用户为（chinaunicom）
unionid          用户统一标识。针对一个微信开放平台帐号下的应用，同一用户的 unionid 是唯一的。
```

### 2、接入微信登录

根据OAuth2协议授权码流程，结合本项目自身特点，分析接入微信扫码登录的流程如下：

![](/image/spring/spring19.png)

本项目认证服务需要做哪些事？

1、需要定义接口接收微信下发的授权码。

2、收到授权码调用微信接口申请令牌。

3、申请到令牌调用微信获取用户信息

4、获取用户信息成功将其写入本项目用户中心数据库。

5、最后重定向到浏览器自动登录。

#### 1） 定义接口

参考接口规范中“请求获取授权码” 定义接收微信下发的授权码接口，

定义WxLoginController类，如下：

```Java
@Slf4j
@Controller
public class WxLoginController {

    @RequestMapping("/wxLogin")
    public String wxLogin(String code, String state) throws IOException {
        log.debug("微信扫码回调,code:{},state:{}",code,state);
        //请求微信申请令牌，拿到令牌查询用户信息，将用户信息写入本项目数据库
        XcUser xcUser = new XcUser();
        //暂时硬编写，目的是调试环境
        xcUser.setUsername("t1");
        if(xcUser==null){
            return "redirect:http://www.51xuecheng.cn/error.html";
        }
        String username = xcUser.getUsername();
        return "redirect:http://www.51xuecheng.cn/sign.html?username="+username+"&authType=wx";
    }
}
```

定义微信认证的service

```Java
@Slf4j
@Service("wx_authservice")
public class WxAuthServiceImpl implements AuthService {

    @Autowired
    XcUserMapper xcUserMapper;

    @Override
    public XcUserExt execute(AuthParamsDto authParamsDto) {

        //账号
        String username = authParamsDto.getUsername();
        XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper<XcUser>().eq(XcUser::getUsername, username));
        if(user==null){
            //返回空表示用户不存在
            throw new RuntimeException("账号不存在");
        }
        XcUserExt xcUserExt = new XcUserExt();
        BeanUtils.copyProperties(user,xcUserExt);
        return xcUserExt;
    }
}
```

#### 2）接口环境测试

接口定义好下边进行测试下，主要目的是测试接口调度的环境。

1、启动内网穿透工具

2、在/wxLogin接口中打断点

3、打开前端微信扫码页面，点击微信图标打开二维码，用户扫码，确认授权此时正常进入 /wxLogin  方法，最后跳转到http://www.51xuecheng.cn/sign.html?username=t1&authType=wx。

#### 3）接入微信认证 

接下来请求微信申请令牌。

1、使用restTemplate请求微信，配置RestTemplate bean

在启动类配置restTemplate

```Java
    @Bean
    RestTemplate restTemplate(){
        RestTemplate restTemplate = new RestTemplate(new OkHttp3ClientHttpRequestFactory());
        return  restTemplate;
    }
```

2、定义与微信认证的service接口：

```Java
public interface WxAuthService {

    public XcUser wxAuth(String code);

}
```

3、下边在controller中调用wxAuth接口：

```Java
@Slf4j
@Controller
public class WxLoginController {

    @Autowired
    WxAuthService wxAuthService;

    @RequestMapping("/wxLogin")
    public String wxLogin(String code, String state) throws IOException {
        log.debug("微信扫码回调,code:{},state:{}",code,state);
        //请求微信申请令牌，拿到令牌查询用户信息，将用户信息写入本项目数据库
        XcUser xcUser = wxAuthService.wxAuth(code);
        if(xcUser==null){
            return "redirect:http://www.51xuecheng.cn/error.html";
        }
        String username = xcUser.getUsername();
        return "redirect:http://www.51xuecheng.cn/sign.html?username="+username+"&authType=wx";
    }
}
```

4、在WxAuthService 的wxAuth方法中实现申请令牌、查询用户信息等内容。

```Java
@Slf4j
@Service("wx_authservice")
public class WxAuthServiceImpl implements AuthService, WxAuthService {
@Autowired
XcUserMapper xcUserMapper;
@Autowired
RestTemplate restTemplate;

@Value("${weixin.appid}")
String appid;
@Value("${weixin.secret}")
String secret;

public XcUser wxAuth(String code){

    //收到code调用微信接口申请access_token
    Map<String, String> access_token_map = getAccess_token(code);
    if(access_token_map==null){
        return null;
    }
    System.out.println(access_token_map);
    String openid = access_token_map.get("openid");
    String access_token = access_token_map.get("access_token");
    //拿access_token查询用户信息
    Map<String, String> userinfo = getUserinfo(access_token, openid);
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
 "access_token":"ACCESS_TOKEN",
 "expires_in":7200,
 "refresh_token":"REFRESH_TOKEN",
 "openid":"OPENID",
 "scope":"SCOPE",
 "unionid": "o6_bmasdasdsad6_2sgVt7hMZOPfL"
 }
*/
private Map<String,String> getAccess_token(String code) {

    String wxUrl_template = "https://api.weixin.qq.com/sns/oauth2/access_token?appid=%s&secret=%s&code=%s&grant_type=authorization_code";
    //请求微信地址
    String wxUrl = String.format(wxUrl_template, appid, secret, code);

    log.info("调用微信接口申请access_token, url:{}", wxUrl);

    ResponseEntity<String> exchange = restTemplate.exchange(wxUrl, HttpMethod.POST, null, String.class);

    String result = exchange.getBody();
    log.info("调用微信接口申请access_token: 返回值:{}", result);
    Map<String,String> resultMap = JSON.parseObject(result, Map.class);

    return resultMap;
}

/**获取用户信息，示例如下：
 {
 "openid":"OPENID",
 "nickname":"NICKNAME",
 "sex":1,
 "province":"PROVINCE",
 "city":"CITY",
 "country":"COUNTRY",
 "headimgurl": "https://thirdwx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/0",
 "privilege":[
 "PRIVILEGE1",
 "PRIVILEGE2"
 ],
 "unionid": " o6_bmasdasdsad6_2sgVt7hMZOPfL"
 }
*/
private Map<String,String> getUserinfo(String access_token,String openid) {

    String wxUrl_template = "https://api.weixin.qq.com/sns/userinfo?access_token=%s&openid=%s";
    //请求微信地址
    String wxUrl = String.format(wxUrl_template, access_token,openid);

    log.info("调用微信接口申请access_token, url:{}", wxUrl);

    ResponseEntity<String> exchange = restTemplate.exchange(wxUrl, HttpMethod.POST, null, String.class);

    //防止乱码进行转码
    String result = new     String(exchange.getBody().getBytes(StandardCharsets.ISO_8859_1),StandardCharsets.UTF_8);
    log.info("调用微信接口申请access_token: 返回值:{}", result);
    Map<String,String> resultMap = JSON.parseObject(result, Map.class);

    return resultMap;
}
....
```

测试获取用户信息

1、在获取用户信息处打断点

2、进入http://www.51xuecheng.cn/wxsign.html

3、手机扫码授权

#### 4）保存用户信息

向数据库保存用户信息，如果用户不存在将其保存在数据库。

```Java
@Autowired
XcUserRoleMapper xcUserRoleMapper;

@Transactional
public XcUser addWxUser(Map userInfo_map){
    String unionid = userInfo_map.get("unionid").toString();
    //根据unionid查询数据库
    XcUser xcUser = xcUserMapper.selectOne(new LambdaQueryWrapper<XcUser>().eq(XcUser::getWxUnionid, unionid));
    if(xcUser!=null){
        return xcUser;
    }
    String userId = UUID.randomUUID().toString();
    xcUser = new XcUser();
    xcUser.setId(userId);
    xcUser.setWxUnionid(unionid);
    //记录从微信得到的昵称
    xcUser.setNickname(userInfo_map.get("nickname").toString());
    xcUser.setUserpic(userInfo_map.get("headimgurl").toString());
    xcUser.setName(userInfo_map.get("nickname").toString());
    xcUser.setUsername(unionid);
    xcUser.setPassword(unionid);
    xcUser.setUtype("101001");//学生类型
    xcUser.setStatus("1");//用户状态
    xcUser.setCreateTime(LocalDateTime.now());
    xcUserMapper.insert(xcUser);
    XcUserRole xcUserRole = new XcUserRole();
    xcUserRole.setId(UUID.randomUUID().toString());
    xcUserRole.setUserId(userId);
    xcUserRole.setRoleId("17");//学生角色
    xcUserRoleMapper.insert(xcUserRole);
    return xcUser;
}
```

调用保存用户信息

```Java
@Autowired
WxAuthServiceImpl currentProxy;

public XcUser wxAuth(String code){

    //收到code调用微信接口申请access_token
    Map<String, String> access_token_map = getAccess_token(code);
    if(access_token_map==null){
        return null;
    }
    System.out.println(access_token_map);
    String openid = access_token_map.get("openid");
    String access_token = access_token_map.get("access_token");
    //拿access_token查询用户信息
    Map<String, String> userinfo = getUserinfo(access_token, openid);
    if(userinfo==null){
        return null;
    }
    //将用户信息保存到数据库
    XcUser xcUser = currentProxy.addWxUser(userinfo);
    return xcUser;
}
```

测试保存用户信息

1、在保存用户信息处打断点

2、进入http://www.51xuecheng.cn/wxsign.html

3、手机扫码授权

4、自动跳转到登录页面，提交认证成功。

## 三、用户授权

### 1、RBAC

如何实现授权？业界通常基于RBAC实现授权。

::: info RBAC分为两种方式：

- 基于角色的访问控制（Role-Based Access Control）

- 基于资源的访问控制（Resource-Based Access Control）

:::

- 1. 角色的访问控制（Role-Based Access Control）是按角色进行授权，比如：主体的角色为总经理可以查询企业运营报表，查询员工工资信息等，访问控制流程如下：

![](/image/spring/spring20.png)

根据上图中的判断逻辑，授权代码可表示如下：

```Java
if(主体.hasRole("总经理角色id")){
查询工资
}
```

如果上图中查询工资所需要的角色变化为总经理和部门经理，此时就需要修改判断逻辑为“判断用户的角色是否是总经理或部门经理”，修改代码如下：

```Java
if(主体.hasRole("总经理角色id") ||  主体.hasRole("部门经理角色id")){
    查询工资
}
```

根据上边的例子发现，当需要修改角色的权限时就需要修改授权的相关代码，系统可扩展性差。 

- 2. 基于资源的访问控制（Resource-Based Access Control）是按资源（或权限）进行授权，比如：用户必须具有查询工资权限才可以查询员工工资信息等，访问控制流程如下：

![](/image/spring/spring21.png)

根据上图中的判断，授权代码可以表示为：

```Java
if(主体.hasPermission("查询工资权限标识")){
    查询工资
}
```

::: important 优点

系统设计时定义好查询工资的权限标识，即使查询工资所需要的角色变化为总经理和部门经理也不需要修改授权代码，系统可扩展性强。

:::

### 2、资源服务授权流程

本项目在资源服务内部进行授权，基于资源的授权模式，因为接口在资源服务，通过在接口处添加授权注解实现授权。

**1）首先配置nginx代理**

```Java
   http {
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
```

加载nginx 配置。

**2）在资源服务集成Spring Security**

在需要授权的接口处使用`@PreAuthorize("hasAuthority('权限标识符')")`进行控制

下边代码指定/course/list接口需要拥有`xc_teachmanager_course_list `权限。

```java
 		@PostMapping("list")
    @PreAuthorize("hasAuthority('xc_teachmanager_course_list')")
    public PageResult<CourseBase> list(PageParams pageParams,@RequestBody(required = false) 			QueryCourseParamsDTO queryCourseParamsDTO){
...
```

设置了@PreAuthorize表示执行此方法需要授权，如果当前用户请求接口没有权限则抛出异常

`org.springframework.security.access.AccessDeniedException: 不允许访问`

**3）在统一异常处理处解析此异常信息**

```Java
@ResponseBody
@ExceptionHandler(Exception.class)
@ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
public RestErrorResponse exception(Exception e) {

   log.error("【系统异常】{}",e.getMessage(),e);
   e.printStackTrace();
   if(e.getMessage().equals("不允许访问")){   # 没有权限时候的错误信息
      return new RestErrorResponse("没有操作此功能的权限");
   }
   return new RestErrorResponse(CommonError.UNKOWN_ERROR.getErrMessage());


}
```

**4）重启资源服务进行测试**

使用教学机构用户登录系统，这里使用t1用户登录，账号:t1、密码：111111，登录成功，点击“教学机构”,当用户没有权限时页面提示：没有操作此功能的权限。

### 3、授权相关的数据模型

如何给用户分配权限呢？首先要学习数据模型，本项目授权相关的数据表如下：

![](/image/spring/spring22.png)

::: tip 说明如下：

`xc_user`：用户表，存储了系统用户信息，用户类型包括：学生、老师、管理员等

`xc_role`：角色表，存储了系统的角色信息，学生、老师、教学管理员、系统管理员等。

`xc_user_role`：用户角色表，一个用户可拥有多个角色，一个角色可被多个用户所拥有

`xc_menu`:模块表，记录了菜单及菜单下的权限

`xc_permission`:角色权限表，一个角色可拥有多个权限，一个权限可被多个角色所拥有

:::

本项目要求掌握基于权限数据模型（5张数据表），要求在数据库中操作完成给用户分配权限、查询用户权限等需求。

- **1）查询用户所拥有的权限**

步骤：查询用户的id->查询用户所拥有的角色->查询用户所拥有的权限

例子：

`SELECT * FROM xc_menu WHERE id IN(    SELECT menu_id FROM xc_permission WHERE role_id IN(        SELECT role_id FROM xc_user_role WHERE user_id = '49'    ) )`

- **2）给用户分配权限**

    - a）添加权限

        查询用户的id->查询权限的id->查询用户的角色，如果没有角色需要先给用户指定角色->向角色权限表添加记录

    - b）删除用户权限

​		本项目是基于角色分配权限，如果要删除用户的权限可以给用户换角色，那么新角色下的权限就是用户的权限；如果不换用户的角色可以删除角色下的权限即删除角色权限关系表相应记录，这样操作是将角色下的权限删除，属于该角色的用户都将删除此权限。

### 4、查询用户权限

使用Spring Security进行授权，首先在生成jwt前会查询用户的权限，如下图：

![](/image/spring/spring23.png)

接下来需要修改UserServiceImpl和PasswordAuthServiceImpl从数据库查询用户的权限。

**1）定义mapper接口**

```Java
public interface XcMenuMapper extends BaseMapper<XcMenu> {
    @Select("SELECT    * FROM xc_menu WHERE id IN (SELECT menu_id FROM xc_permission WHERE role_id IN ( SELECT role_id FROM xc_user_role WHERE user_id = #{userId} ))")
    List<XcMenu> selectPermissionByUserId(@Param("userId") String userId);
}
```

**2）修改`PasswordAuthServiceImpl`**

修改`UserServiceImpl`类的`getUserPrincipal`方法，查询权限信息

```Java
//查询用户身份
public UserDetails getUserPrincipal(XcUserExt user){
    String password = user.getPassword();
    //查询用户权限
    List<XcMenu> xcMenus = menuMapper.selectPermissionByUserId(user.getId());
    List<String> permissions = new ArrayList<>();
    if(xcMenus.size()<=0){
        //用户权限,如果不加则报Cannot pass a null GrantedAuthority collection
        permissions.add("p1");
    }else{
        xcMenus.forEach(menu->{
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
```

### 6、细粒度授权

#### 1）什么是细粒度授权

细粒度授权也叫数据范围授权，即不同的用户所拥有的操作权限相同，但是能够操作的数据范围是不一样的。一个例子：用户A和用户B都是教学机构，他们都拥有“我的课程”权限，但是两个用户所查询到的数据是不一样的。

本项目有哪些细粒度授权？

**比如：**

- 我的课程，教学机构只允许查询本教学机构下的课程信息。

- 我的选课，学生只允许查询自己所选课。

**如何实现细粒度授权？**

细粒度授权涉及到不同的业务逻辑，通常在service层实现，根据不同的用户进行校验，根据不同的参数查询不同的数据或操作不同的数据。

#### 5.6.2 教学机构细粒度授权

教学机构在维护课程时只允许维护本机构的课程，教学机构细粒度授权过程如下：

获取当前登录的用户身份->得到用户所属教育机构的Id->查询该教学机构下的课程信息

最终实现了用户只允许查询自己机构的课程信息。

根据公司Id查询课程，流程如下：

- a）教学机构用户登录系统，从用户身份中取出所属机构的id，在用户表中设计了company_id字段存储该用户所属的机构id.

- b）接口层取出当前登录用户的身份，取出机构id

- c）将机构id传入service方法。

- d）service方法将机构id传入Dao方法，最终查询出本机构的课程信息。

代码实现如下：

```Java
@ApiOperation("课程查询接口")
@PreAuthorize("hasAuthority('xc_teachmanager_course_list')")//拥有课程列表查询的权限方可访问
@PostMapping("/course/list")
public PageResult<CourseBase> list(PageParams pageParams, @RequestBody QueryCourseParamsDto queryCourseParams){
    //取出用户身份
    XcUser user = SecurityUtil.getUser();
    //机构id
    String companyId = user.getCompanyId();
    return courseBaseInfoService.queryCourseBaseList(Long.parseLong(companyId),pageParams,queryCourseParams);
}
```

Service方法如下：

```Java
@Override
public PageResult<CourseBase> queryCourseBaseList(Long companyId,PageParams pageParams, QueryCourseParamsDto queryCourseParamsDto) {

 //构建查询条件对象
 LambdaQueryWrapper<CourseBase> queryWrapper = new LambdaQueryWrapper<>();
 //机构id
 queryWrapper.eq(CourseBase::getCompanyId,companyId);
 ....
```

