<template><div><!--more--->
<h1 id="认证授权" tabindex="-1"><a class="header-anchor" href="#认证授权"><span>认证授权</span></a></h1>
<h2 id="一、统一认证" tabindex="-1"><a class="header-anchor" href="#一、统一认证"><span>一、统一认证</span></a></h2>
<h3 id="_1、连接数据库认证" tabindex="-1"><a class="header-anchor" href="#_1、连接数据库认证"><span>1、连接数据库认证</span></a></h3>
<p>基于的认证流程在研究Spring Security过程中已经测试通过，到目前为止用户认证流程如下：</p>
<figure><img src="/image/project/p4.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>认证所需要的用户信息存储在用户中心数据库，现在需要将认证服务连接数据库查询用户信息。</p>
<p>前边学习Spring Security工作原理时有一张执行流程图，如下图：</p>
<figure><img src="/image/project/p5.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>用户提交账号和密码由DaoAuthenticationProvider调用UserDetailsService的loadUserByUsername()方法获取UserDetails用户信息。</p>
<p>查询DaoAuthenticationProvider的源代码如下：</p>
<figure><img src="/image/project/p6.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>UserDetailsService是一个接口，如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package org.springframework.security.core.userdetails;

public interface UserDetailsService {
    UserDetails loadUserByUsername(String var1) throws UsernameNotFoundException;
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>UserDetails是用户信息接口</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public interface UserDetails extends Serializable {
    Collection&lt;? extends GrantedAuthority&gt; getAuthorities();

    String getPassword();

    String getUsername();

    boolean isAccountNonExpired();

    boolean isAccountNonLocked();

    boolean isCredentialsNonExpired();

    boolean isEnabled();
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>我们只要实现UserDetailsService 接口查询数据库得到用户信息返回UserDetails 类型的用户信息即可,框架调用loadUserByUsername()方法拿到用户信息之后是如何执行的，见下图：</p>
<figure><img src="/image/project/p7.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<p>首先屏蔽原来定义的UserDetailsService。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>    //配置用户信息服务
//    @Bean
//    public UserDetailsService userDetailsService() {
//        //这里配置用户信息,这里暂时使用这种方式将用户存储在内存中
//        InMemoryUserDetailsManager manager = new InMemoryUserDetailsManager();
//        manager.createUser(User.withUsername(&quot;zhangsan&quot;).password(&quot;123&quot;).authorities(&quot;p1&quot;).build());
//        manager.createUser(User.withUsername(&quot;lisi&quot;).password(&quot;456&quot;).authorities(&quot;p2&quot;).build());
//        return manager;
//    }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>下边自定义UserDetailsService</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.ucenter.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.xuecheng.ucenter.mapper.XcUserMapper;
import com.xuecheng.ucenter.model.po.XcUser;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;


@Service
public class UserServiceImpl implements UserDetailsService {

    @Autowired
    XcUserMapper xcUserMapper;

    /**
     * @description 根据账号查询用户信息
     * @param s  账号
     * @return org.springframework.security.core.userdetails.UserDetails
    */
    @Override
    public UserDetails loadUserByUsername(String s) throws UsernameNotFoundException {

        XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper&lt;XcUser&gt;().eq(XcUser::getUsername, s));
        if(user==null){
            //返回空表示用户不存在
            return null;
        }
        //取出数据库存储的正确密码
        String password  =user.getPassword();
        //用户权限,如果不加报Cannot pass a null GrantedAuthority collection
        String[] authorities= {&quot;test&quot;};
        //创建UserDetails对象,权限信息待实现授权功能时再向UserDetail中加入
        UserDetails userDetails = User.withUsername(user.getUsername()).password(password).authorities(authorities).build();

        return userDetails;
    }


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>数据库中的密码加过密的，用户输入的密码是明文，我们需要修改密码格式器PasswordEncoder，原来使用的是NoOpPasswordEncoder，它是通过明文方式比较密码，现在我们修改为BCryptPasswordEncoder，它是将用户输入的密码编码为BCrypt格式与数据库中的密码进行比对。</p>
<p>如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>    @Bean
    public PasswordEncoder passwordEncoder() {
//        //密码为明文方式
//        return NoOpPasswordEncoder.getInstance();
        return new BCryptPasswordEncoder();
    }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>我们通过测试代码测试BCryptPasswordEncoder，如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>public static void main(String[] args) {
    String password = &quot;111111&quot;;
    PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    for(int i=0;i&lt;10;i++) {
        //每个计算出的Hash值都不一样
        String hashPass = passwordEncoder.encode(password);
        System.out.println(hashPass);
        //虽然每次计算的密码Hash值不一样但是校验是通过的
        boolean f = passwordEncoder.matches(password, hashPass);
        System.out.println(f);
    }
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改数据库中的密码为Bcrypt格式，并且记录明文密码，稍后申请令牌时需要。</p>
<p>由于修改密码编码方式还需要将客户端的密钥更改为Bcrypt格式.</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code> @Override
  public void configure(ClientDetailsServiceConfigurer clients)
          throws Exception {
        clients.inMemory()// 使用in-memory存储
                .withClient(&quot;XcWebApp&quot;)// client_id
//                .secret(&quot;secret&quot;)//客户端密钥
                .secret(new BCryptPasswordEncoder().encode(&quot;XcWebApp&quot;))//客户端密钥
                .resourceIds(&quot;xuecheng-plus&quot;)//资源列表
                .authorizedGrantTypes(&quot;authorization_code&quot;, &quot;password&quot;,&quot;client_credentials&quot;,&quot;implicit&quot;,&quot;refresh_token&quot;)// 该client允许的授权类型authorization_code,password,refresh_token,implicit,client_credentials
                .scopes(&quot;all&quot;)// 允许的授权范围
                .autoApprove(false)//false跳转到授权页面
                //客户端接收授权码的重定向地址
                .redirectUris(&quot;http://www.51xuecheng.cn&quot;)
   ;
  }
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>现在重启认证服务。</p>
<p>下边使用httpclient进行测试：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>### 密码模式
POST {{auth_host}}/oauth/token?client_id=XcWebApp&amp;client_secret=XcWebApp&amp;grant_type=password&amp;username=stu1&amp;password=111111
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div></div></div><p>输入正确的账号和密码，申请令牌成功。</p>
<h3 id="_2、扩展用户信息" tabindex="-1"><a class="header-anchor" href="#_2、扩展用户信息"><span>2、扩展用户信息</span></a></h3>
<p>用户表中存储了用户的账号、手机号、email，昵称、qq等信息，UserDetails接口只返回了username、密码等信息。我们需要扩展用户身份的信息，在jwt令牌中存储用户的昵称、头像、qq等信息。</p>
<p><strong>如何扩展Spring Security的用户身份信息呢？</strong></p>
<p>在认证阶段DaoAuthenticationProvider会调用UserDetailService查询用户的信息，这里是可以获取到齐全的用户信息的。由于JWT令牌中用户身份信息来源于UserDetails，UserDetails中仅定义了username为用户的身份信息。</p>
<p>这里有两个思路：</p>
<ul>
<li>
<p>第一是可以扩展UserDetails，使之包括更多的自定义属性，</p>
</li>
<li>
<p>第二也可以扩展username的内容 ，比如存入json数据内容作为username的内容。</p>
<p><strong>相比较而言，方案二比较简单还不用破坏UserDetails的结构，我们采用方案二。</strong></p>
</li>
</ul>
<p>修改UserServiceImpl如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.ucenter.service.impl;

@Service
public class UserServiceImpl implements UserDetailsService {

    @Autowired
    XcUserMapper xcUserMapper;

    /**
     * @description 根据账号查询用户信息
     * @param s  账号
     * @return org.springframework.security.core.userdetails.UserDetails
    */
    @Override
    public UserDetails loadUserByUsername(String s) throws UsernameNotFoundException {

        XcUser user = xcUserMapper.selectOne(new LambdaQueryWrapper&lt;XcUser&gt;().eq(XcUser::getUsername, s));
        if(user==null){
            //返回空表示用户不存在
            return null;
        }

        //取出数据库存储的正确密码
        String password  =user.getPassword();
        //用户权限,如果不加报Cannot pass a null GrantedAuthority collection
        String[] authorities = {&quot;p1&quot;};
       //为了安全在令牌中不放密码
        user.setPassword(null);
        //将user对象转json
        String userString = JSON.toJSONString(user);
        //创建UserDetails对象
        UserDetails userDetails = User.withUsername(userString).password(password).authorities(authorities).build();

        return userDetails;
    }


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>重启认证服务，重新生成令牌，生成成功。</p>
<h3 id="_3、资源服务获取用户身份" tabindex="-1"><a class="header-anchor" href="#_3、资源服务获取用户身份"><span>3、资源服务获取用户身份</span></a></h3>
<p>下边编写一个工具类在各个微服务中去使用，获取当前登录用户的对象。</p>
<p>在content-api中定义此类：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.content.util;

import com.alibaba.fastjson.JSON;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.context.SecurityContextHolder;

import java.io.Serializable;
import java.time.LocalDateTime;

@Slf4j
public class SecurityUtil {

    public static XcUser getUser() {
        try {
            Object principalObj = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
            if (principalObj instanceof String) {
                //取出用户身份信息
                String principal = principalObj.toString();
                //将json转成对象
                XcUser user = JSON.parseObject(principal, XcUser.class);
                return user;
            }
        } catch (Exception e) {
            log.error(&quot;获取当前登录用户身份出错:{}&quot;, e.getMessage());
            e.printStackTrace();
        }

        return null;
    }


    @Data
    public static class XcUser implements Serializable {

        private static final long serialVersionUID = 1L;

        private String id;

        private String username;

        private String password;

        private String salt;

        private String name;
        private String nickname;
        private String wxUnionid;
        private String companyId;
        /**
         * 头像
         */
        private String userpic;

        private String utype;

        private LocalDateTime birthday;

        private String sex;

        private String email;

        private String cellphone;

        private String qq;

        /**
         * 用户状态
         */
        private String status;

        private LocalDateTime createTime;

        private LocalDateTime updateTime;


    }


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>下边在内容管理服务中测试此工具类，以查询课程信息接口为例：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@ApiOperation(&quot;根据课程id查询课程基础信息&quot;)
@GetMapping(&quot;/course/{courseId}&quot;)
public CourseBaseInfoDto getCourseBaseById(@PathVariable(&quot;courseId&quot;) Long courseId){
    //取出当前用户身份
//    Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
   SecurityUtil.XcUser user = SecurityUtil.getUser();
    System.out.println(user);

    return courseBaseInfoService.getCourseBaseInfo(courseId);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><h3 id="_4、统一认证入口" tabindex="-1"><a class="header-anchor" href="#_4、统一认证入口"><span>4、统一认证入口</span></a></h3>
<p>目前各大网站的认证方式非常丰富：账号密码认证、手机验证码认证、扫码登录等。</p>
<p>基于当前研究的Spring Security认证流程如何支持多样化的认证方式呢？</p>
<ul>
<li>
<p>1、支持账号和密码认证,采用OAuth2协议的密码模式即可实现。</p>
</li>
<li>
<p>2、支持手机号加验证码认证,用户认证提交的是手机号和验证码，并不是账号和密码。</p>
</li>
<li>
<p>3、微信扫码认证,基于OAuth2协议与微信交互，学成在线网站向微信服务器申请到一个令牌，然后携带令牌去微信查询用户信息，查询成功则用户在学成在线项目认证通过。</p>
</li>
</ul>
<p>目前我们测试通过OAuth2的密码模式，用户认证会提交账号和密码，由<code v-pre>DaoAuthenticationProvider</code>调用<code v-pre>UserDetailsService的loadUserByUsername()</code>方法获取<code v-pre>UserDetails</code>用户信息。</p>
<p>在前边我们自定义了<code v-pre>UserDetailsService</code>接口实现类，通过<code v-pre>loadUserByUsername()</code>方法根据账号查询用户信息。</p>
<p>而不同的认证方式提交的数据不一样，比如：手机加验证码方式会提交手机号和验证码，账号密码方式会提交账号、密码、验证码。</p>
<p>我们可以在<code v-pre>loadUserByUsername()</code>方法上作文章，将用户原来提交的账号数据改为提交json数据，json数据可以扩展不同认证方式所提交的各种参数。</p>
<p>首先创建一个DTO类表示认证的参数：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.ucenter.model.dto;

import lombok.Data;

import java.util.HashMap;
import java.util.Map;

/**
 * @description 认证用户请求参数
 */
@Data
public class AuthParamsDto {

    private String username; //用户名
    private String password; //域  用于扩展
    private String cellphone;//手机号
    private String checkcode;//验证码
    private String checkcodekey;//验证码key
    private String authType; // 认证的类型   password:用户名密码模式类型    sms:短信模式类型
    private Map&lt;String, Object&gt; payload = new HashMap&lt;&gt;();//附加数据，作为扩展，不同认证类型可拥有不同的附加数据。如认证类型为短信时包含smsKey : sms:3d21042d054548b08477142bbca95cfa; 所有情况下都包含clientId


}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>此时<code v-pre>loadUserByUsername()</code>方法可以修改如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Slf4j
@Service
public class UserServiceImpl implements UserDetailsService {

    @Autowired
    XcUserMapper xcUserMapper;

    /**
     * @description 查询用户信息组成用户身份信息
     * @param s  AuthParamsDto类型的json数据
     * @return org.springframework.security.core.userdetails.UserDetails
    */
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
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>原来的<code v-pre>DaoAuthenticationProvider</code> 会进行密码校验，现在重新定义<code v-pre>DaoAuthenticationProviderCustom</code>类，重写类的<code v-pre>additionalAuthenticationChecks</code>方法。</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.auth.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.stereotype.Component;

/**
 * @description 自定义DaoAuthenticationProvider
 */
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
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>修改<code v-pre>WebSecurityConfig</code>类指定<code v-pre>daoAuthenticationProviderCustom</code></p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Autowired
DaoAuthenticationProviderCustom daoAuthenticationProviderCustom;


@Override
protected void configure(AuthenticationManagerBuilder auth) throws Exception {
    auth.authenticationProvider(daoAuthenticationProviderCustom);
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>此时可以重启认证服务，测试申请令牌接口，传入的账号信息改为json数据，如下：</p>
<div class="language-Plain line-numbers-mode" data-ext="Plain" data-title="Plain"><pre v-pre class="language-Plain"><code>################扩展认证请求参数后######################
###密码模式
POST {{auth_host}}/auth/oauth/token?client_id=XcWebApp&amp;client_secret=XcWebApp&amp;grant_type=password&amp;username={&quot;username&quot;:&quot;stu1&quot;,&quot;authType&quot;:&quot;password&quot;,&quot;password&quot;:&quot;111111&quot;}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>经过测试发现loadUserByUsername()方法可以正常接收到认证请求中的json数据。</p>
<p>有了这些认证参数我们可以定义一个认证Service接口去进行各种方式的认证。</p>
<p>定义用户信息，为了扩展性让它继承XcUser</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>@Data
public class XcUserExt extends XcUser {
}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>定义认证Service 接口</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.ucenter.service;

import com.xuecheng.ucenter.model.dto.AuthParamsDto;
import com.xuecheng.ucenter.model.po.XcUser;

/**
 * @description 认证service
 */
public interface AuthService {

   /**
    * @description 认证方法
    * @param authParamsDto 认证参数
    * @return com.xuecheng.ucenter.model.po.XcUser 用户信息
   */
   XcUserExt execute(AuthParamsDto authParamsDto);

}
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>loadUserByUsername()修改如下：</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>/**
 * @version 1.0
 * @description 自定义UserDetailsService用来对接Spring Security
 */
@Slf4j
@Service
public class UserServiceImpl implements UserDetailsService {

    @Autowired
    XcUserMapper xcUserMapper;

    @Autowired
    ApplicationContext applicationContext;


    /**
     * @description 查询用户信息组成用户身份信息
     * @param s  AuthParamsDto类型的json数据
     * @return org.springframework.security.core.userdetails.UserDetails
    */
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


    /**
     * @description 查询用户信息
     * @param user  用户id，主键
     * @return com.xuecheng.ucenter.model.po.XcUser 用户信息
    */
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
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div><p>到此我们基于Spring Security认证流程修改为如下：</p>
<figure><img src="/image/project/p8.png" alt="" tabindex="0" loading="lazy"><figcaption></figcaption></figure>
<h3 id="_5、实现账号密码认证" tabindex="-1"><a class="header-anchor" href="#_5、实现账号密码认证"><span>5、实现账号密码认证</span></a></h3>
<p>上节定义了AuthService认证接口，下边实现该接口实现账号密码认证</p>
<div class="language-Java line-numbers-mode" data-ext="Java" data-title="Java"><pre v-pre class="language-Java"><code>package com.xuecheng.ucenter.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.xuecheng.ucenter.mapper.XcUserMapper;
import com.xuecheng.ucenter.model.dto.AuthParamsDto;
import com.xuecheng.ucenter.model.po.XcUser;
import com.xuecheng.ucenter.service.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * @description 账号密码认证
 */
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
</code></pre><div class="line-numbers" aria-hidden="true"><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div><div class="line-number"></div></div></div></div></template>


