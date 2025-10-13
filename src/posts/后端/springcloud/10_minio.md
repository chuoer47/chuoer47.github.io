---
title: MinIO分布式文件系统
date: 2024-07-22
tags: SpringCloud
category: SpringCloud
order: 10
icon: "/img/MinIO.svg"
---

<!--more--->

# MinIO分布式文件系统

## 一、分布式文件系统

### 1、文件系统

文件系统是负责管理和存储文件的系统软件，操作系统通过文件系统提供的接口去存取文件，用户通过操作系统访问磁盘上的文件。

下图指示了文件系统所处的位置：

![](/image/cloud/cloud41.png)

在已知的操作系统中，它们分别支持多种不同的文件系统。Windows 下支持 FAT、FAT32、NTFS，Linux 支持十多种的文件系统，例如：EXT2、EXT3、EXT4、NFS、NTFS等。

::: info 问题？

一此短视频平台拥有大量的视频、图片，这些视频文件、图片文件该如何存储呢？如何存储可以满足互联网上海量用户的浏览。

:::

通过概念可以简单理解为：一个计算机无法存储海量的文件，通过网络将若干计算机组织起来共同去存储海量的文件，去接收海量用户的请求，这些组织起来的计算机通过网络进行通信，如下图：

![](/image/cloud/cloud42.png)

:::tip 好处：

 1、一台计算机的文件系统处理能力扩充到多台计算机同时处理。

 2、一台计算机挂了还有另外副本计算机提供数据。

 3、每台计算机可以放在不同的地域，这样用户就可以就近访问，提高访问速度。

:::

### 2、分布式文件系统

#### 1）NFS

网络文件系统（NFS）是文件系统之上的一个网络抽象，来允许远程客户端以与本地文件系统类似的方式，来通过网络进行访问。虽然 NFS 不是第一个此类系统，但是它已经发展并演变成 UNIX系统中最强大最广泛使用的网络文件系统。NFS 允许在多个用户之间共享公共文件系统，并提供数据集中的优势，来最小化所需的存储空间。

![](/image/cloud/cloud43.png)

::: important 特点：

- 在客户端上映射NFS服务器的驱动器。

- 客户端通过网络访问NFS服务器的硬盘完全透明。

:::

#### 2）GFS

GFS是一个可扩展的分布式文件系统，用于大型的、分布式的、对人量数据进行访问的应用。它运行于廉价的普通硬件上。可以提供容错功能。它可以给大量的用户提供总体性能较高的服务。

![](/image/cloud/cloud44.png)

::: important

- GFS采用主从结构，一个GFS集群由一个master和大量的chunkserver组成。

- master存储了数据文件的元数据，一个文件被分成了若干块存储在多个chunkserver中。

- 用户从master中获取数据元信息，向chunkserver存储数据。

:::

#### 3）HDFS

HDFS，是Hadoop Distributed File System的简称，是Hadoop抽象文件系统的一种实现。HDFS是一个高度容错性的系统，适合部署在廉价的机器上。HDFS能提供高吞吐量的数据访问，非常适合大规模数据集上的应用。 HDFS的文件分布在集群机器上，同时提供副本进行容错及可靠性保证。例如客户端写入读取文件的直接操作都是分布在集群各个机器上的，没有单点性能压力。

下图是HDFS的架构图：

![](/image/cloud/cloud45.png)

::: important

- HDFS采用主从结构，一个HDFS集群由一个名称结点和若干数据结点组成。

- 名称结点存储数据的元信息，一个完整的数据文件分成若干块存储在数据结点。

- 客户端从名称结点获取数据的元信息及数据分块的信息，得到信息客户端即可从数据块来存取数据。

:::

#### 4）云计算厂家

- 阿里云对象存储服务（Object Storage Service，简称 OSS），是阿里云提供的海量、安全、低成本、高可靠的云存储服务。其数据设计持久性不低于 99.9999999999%（12 个 9），服务设计可用性（或业务连续性）不低于 99.995%。[官方网站](https://www.aliyun.com/product/oss )

- 百度对象存储BOS提供稳定、安全、高效、高可扩展的云存储服务。您可以将任意数量和形式的非结构化数据存入BOS，并对数据进行管理和处理。BOS支持标准、低频、冷和归档存储等多种存储类型，满足多场景的存储需求。 [官方网站](https://cloud.baidu.com/product/bos.html ) 

## 二、MinIO

### 1、介绍

MinIO 是一个非常轻量的服务,可以很简单的和其他应用的结合使用，它兼容亚马逊 S3 云存储服务接口，非常适合于存储大容量非结构化的数据，例如图片、视频、日志文件、备份数据和容器/虚拟机镜像等。

它一大特点就是轻量，使用简单，功能强大，支持各种平台，单个文件最大5TB，兼容 Amazon S3接口，提供了 Java、Python、GO等多版本SDK支持。

- [官网](https://min.io)

- [中文](https://www.minio.org.cn/)

MinIO集群采用去中心化共享架构，每个结点是对等关系，通过Nginx可对MinIO进行负载均衡访问。

**去中心化有什么好处？**

在大数据领域，通常的设计理念都是无中心和分布式。Minio分布式模式可以帮助你搭建一个高可用的对象存储服务，你可以使用这些存储设备，而不用考虑其真实物理位置。

它将分布在不同服务器上的多块硬盘组成一个对象存储服务。由于硬盘分布在不同的节点上，分布式Minio避免了单点故障。如下图：

![](/image/cloud/cloud46.png)

Minio使用纠删码技术来保护数据，它是一种恢复丢失和损坏数据的数学算法，它将数据分块冗余的分散存储在各各节点的磁盘上，所有的可用磁盘组成一个集合。

- 上图由8块硬盘组成一个集合，当上传一个文件时会通过纠删码算法计算对文件进行分块存储，除了将文件本身分成4个数据块，还会生成4个校验块，数据块和校验块会分散的存储在这8块硬盘上。

- 使用纠删码的好处是即便丢失一半数量（N/2）的硬盘，仍然可以恢复数据。 比如上边集合中有4个以内的硬盘损害仍可保证数据恢复，不影响上传和下载，如果多于一半的硬盘坏了则无法恢复。

### 2、部署

使用docker来部署minio服务，具体步骤如下：

**1)编写docker-compose.yml文件**

```yaml
version: '3'
services:
  minio:
    image: minio/minio
    container_name: minio
    volumes:
      - /root/minio/data1:/data1
      - /root/minio/data2:/data2
      - /root/minio/data3:/data3
    command: server --console-address ":9001" /data1 /data2 /data3
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ACCESS_KEY: minio
      MINIO_SECRET_KEY: minio
    networks:
       - hm-net
networks:
  hm-net:
    external: true
```

::: warning

由于只使用了一台服务器，所以使用了三个文件夹来模拟多个节点，有的版本会要求至少四个节点

:::

**2)运行**

```bash
docker compose up -d
```

之后访问[http://localhost:9001](http://localhost:9001 ) 进入UI界面。

![](/image/cloud/cloud47.png)

### 3、SDK

MinIO提供多个语言版本SDK的支持，下边找到java版本的文档：

地址：[https://docs.min.io/docs/java-client-quickstart-guide.html](https://docs.min.io/docs/java-client-quickstart-guide.html)

最低需求Java 1.8或更高版本:

maven依赖如下：

```XML
<dependency>
    <groupId>io.minio</groupId>
    <artifactId>minio</artifactId>
    <version>8.4.3</version>
</dependency>
<dependency>
    <groupId>com.squareup.okhttp3</groupId>
    <artifactId>okhttp</artifactId>
    <version>4.8.1</version>
</dependency>
```

需要三个参数才能连接到minio服务:

- Endpoint    对象存储服务的URL       
-  Access Key  账号
-  Secret Key  密码    

官方的示例代码如下：

```Java
import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.UploadObjectArgs;
import io.minio.errors.MinioException;
import java.io.IOException;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
public class FileUploader {
  public static void main(String[] args)throws IOException, NoSuchAlgorithmException, InvalidKeyException {
    try {
      // Create a minioClient with the MinIO server playground, its access key and secret key.
      MinioClient minioClient =
          MinioClient.builder()
              .endpoint("https://play.min.io")
              .credentials("Q3AM3UQ867SPQQA43P2F", "zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG")
              .build();
      // Make 'asiatrip' bucket if not exist.
      boolean found =
          minioClient.bucketExists(BucketExistsArgs.builder().bucket("asiatrip").build());
      if (!found) {
        // Make a new bucket called 'asiatrip'.
        minioClient.makeBucket(MakeBucketArgs.builder().bucket("asiatrip").build());
      } else {
        System.out.println("Bucket 'asiatrip' already exists.");
      }
      // Upload '/home/user/Photos/asiaphotos.zip' as object name 'asiaphotos-2015.zip' to bucket
      // 'asiatrip'.
      minioClient.uploadObject(
          UploadObjectArgs.builder()
              .bucket("asiatrip")
              .object("asiaphotos-2015.zip")
              .filename("/home/user/Photos/asiaphotos.zip")
              .build());
      System.out.println(
          "'/home/user/Photos/asiaphotos.zip' is successfully uploaded as "
              + "object 'asiaphotos-2015.zip' to bucket 'asiatrip'.");
    } catch (MinioException e) {
      System.out.println("Error occurred: " + e);
      System.out.println("HTTP trace: " + e.httpTrace());
    }
  }
}
```

::: warning

创建完bucket之后要将bucket修改为public

![](/image/cloud/cloud48.png)

:::

**上传：**

```java
public class MinioTest {

    static MinioClient minioClient =
            MinioClient.builder()
                    .endpoint("http://192.168.101.65:9000")
                    .credentials("minioadmin", "minioadmin")
                    .build();

   //上传文件
    @Test
    public  void upload() {
        //根据扩展名取出mimeType
        ContentInfo extensionMatch = ContentInfoUtil.findExtensionMatch(".mp4");
        String mimeType = MediaType.APPLICATION_OCTET_STREAM_VALUE;//通用mimeType，字节流
        if(extensionMatch!=null){
            mimeType = extensionMatch.getMimeType();
        }
        try {
            UploadObjectArgs testbucket = UploadObjectArgs.builder()
                    .bucket("testbucket")
										 //.object("test001.mp4")
                    .object("001/test001.mp4")//添加子目录
                    .filename("D:\\develop\\upload\\1mp4.temp")
                    .contentType(mimeType)//默认根据扩展名确定文件内容类型，也可以指定
                    .build();
            minioClient.uploadObject(testbucket);
            System.out.println("上传成功");
        } catch (Exception e) {
            e.printStackTrace();
            System.out.println("上传失败");
        }

    }

}
```

执行upload方法，分别测试向桶的根目录上传文件以及子目录上传文件。

说明：

设置contentType可以通过com.j256.simplemagic.ContentType枚举类查看常用的mimeType（媒体类型）

通过扩展名得到mimeType，代码如下：

```Java
    //根据扩展名取出mimeType
    ContentInfo extensionMatch = ContentInfoUtil.findExtensionMatch(".mp4");
    String mimeType = MediaType.APPLICATION_OCTET_STREAM_VALUE;//通用mimeType，字节流

		if(extensionMatch!=null){
            mimeType = extensionMatch.getMimeType();
    }
```

**删除文件**

```java
@Test
public void delete(){
    try {
        minioClient.removeObject(
         RemoveObjectArgs.builder().bucket("testbucket").object("001/test001.mp4").build());
        System.out.println("删除成功");
    } catch (Exception e) {
       e.printStackTrace();
        System.out.println("删除失败");
    }
}
```

**查询文件**

```Java
//查询文件
@Test
public void getFile() {
    GetObjectArgs getObjectArgs = GetObjectArgs.builder().bucket("testbucket").object("test001.mp4").build();
    try(
        FilterInputStream inputStream = minioClient.getObject(getObjectArgs);
        FileOutputStream outputStream = new FileOutputStream(new File("D:\\develop\\upload\\1_2.mp4"));
     ) {
        IOUtils.copy(inputStream,outputStream);
     } catch (Exception e) {
        e.printStackTrace();
     }
}
```

校验文件的完整性，对文件计算出md5值，比较原始文件的md5和目标文件的md5，一致则说明完整

```Java
//校验文件的完整性对文件的内容进行md5
FileInputStream fileInputStream1 = new FileInputStream(new File("D:\\develop\\upload\\1.mp4"));
String source_md5 = DigestUtils.md5Hex(fileInputStream1);
FileInputStream fileInputStream = new FileInputStream(new File("D:\\develop\\upload\\1a.mp4"));
String local_md5 = DigestUtils.md5Hex(fileInputStream);
if(source_md5.equals(local_md5)){
    System.out.println("下载成功");
}
```

## 三、AliOSS

### 1、什么是OSS

#### 1）介绍

OSS的英文全称是Object Storage Service ，对象存储服务，是一种使用 HTTP API 存储和检索非结构化数据和元数据对象的工具。
可以理解成是一个资源托管的地方，这些资源，就是上面提到的对象。网站或者系统运营的过程中，可能会存储大量的图片、视频、音频这样的静态资源。如果是在服务器本机存储这些内容，维护成本高，不利于迁移，而且容灾效果不佳。为了解决这些问题，可以将这些静态资源托管到第三方服务中 ，而这个资源托管的服务就是对象存储服务。
  

如果只有存储功能，那么OSS服务就跟硬盘没啥区别了，OSS还要有外部访问的能力，这样才能把静态资源传上去（上行流量），别人才可以把这些静态资源下载下来（下行流量）。
  

总结来讲，**OSS就是集存储与访问于一身的资源对象托管服务，用于存储静态资源，同时还提供备份、容灾等常见功能**。

::: tip 注意点：

- 对象，指的是非结构化的静态资源，如图片、音频、视频、日志文件等。
- OSS提供的服务有存储、访问、备份、容灾等。
- OSS一般指第三方云厂商提供的对象存储服务，当然也可以自己在本地机房搭建自己的对象存储，如使用Minio等搭建分布式文件存储服务，用作对象存储。

:::

#### 2）OSS中的相关术语

**1.存储空间（Buket）**

存储空间是用于存储对象的容器，所有的对象都存储在某个存储空间中。

**2.对象/文件（Object）**

对象是OSS存储数据的基本单元，也被称为OSS的文件，对象由元信息（Object Meta）、用户数据（Data）和文件名（Key）组成。对象由存储空间内部唯一的key来标识。

**3.地域（Region）**

地域表示OSS的数据中心所在的物理位置，可以根据费用、请求来源等来选择数据存储的地域。

**4.访问域名（Endpoint）**

Endpoint表示对外提供服务的访问域名，OSS以 HTTP restful API 对外提供服务，当访问不同地域的时候，需要不同的域名。通过内网和外网访问同一个地域所需要的域名是不同的。

**5.访问密钥（AccessKey）**

简称AK，指的是访问身份验证中用到的AccessKeyId和AccessKeySecret。OSS通过使用AccessKeyId和AccessKeySecret对称加密的方法来验证某个请求发送者的身份。AccessKeyId用来标识用户，AccessKeySecret用于加密签名字符串和OSS用来验证签名字符串的密钥，AccessKeySecret必须保密。


### 2、使用

#### 1）UUID

**介绍**

UUID全称：Universally Unique Identifier，即通用唯一识别码。

UUID是由一组32位数的16进制数字所构成，是故UUID理论上的总数为16^32 = 2^128，约等于3.4 x 10^38。也就是说若每纳秒产生1兆个UUID，要花100亿年才会将所有UUID用完。

UUID的标准型式包含32个16进制数字，以连字号分为五段，形式为8-4-4-4-12的32个字符，如：550e8400-e29b-41d4-a716-446655440000。

**UUID的作用：**

UUID的是让分布式系统中的所有元素都能有唯一的辨识信息，而不需要通过中央控制端来做辨识信息的指定。如此一来，每个人都可以创建不与其它人冲突的UUID。在这样的情况下，就不需考虑数据库创建时的名称重复问题。目前最广泛应用的UUID，是微软公司的全局唯一标识符（GUID），而其他重要的应用，则有Linux ext2/ext3文件系统、LUKS加密分区、GNOME、KDE、Mac OS X等等。

**UUID的组成：**

UUID是指在一台机器上生成的数字，它保证对在同一时空中的所有机器都是唯一的。通常平台会提供生成的API。按照开放软件基金会(OSF)制定的标准计算，用到了以太网卡地址、纳秒级时间、芯片ID码和许多可能的数字。

**UUID由以下几部分的组合**：

当前日期和时间，UUID的第一个部分与时间有关，如果你在生成一个UUID之后，过几秒又生成一个UUID，则第一个部分不同，其余相同。

**使用**

使用UUID可以生成唯一文件名

```java
 UUID.randomUUID().toString()
```

#### 2）本地存储

```java
    @PostMapping("/upload")
    public Result upload(String username, String age, MultipartFile image) throws IOException {
        log.info("文件上传：{},{},{}",username, age, image);


        //获取原始文件名
        String originalFilename = image.getOriginalFilename();
        int index = originalFilename.lastIndexOf(".");
        String extname = originalFilename.substring(index);

        //构造唯一文件名  uuid 通用唯一识别码
        String newFileName = UUID.randomUUID().toString() + extname;
        log.info("新文件名：{}",newFileName);
        // 将接收到的文件存储到本地
        image.transferTo(new File("D:\\hnu\\javaStudy\\最新版JavaWeb开发教程\\资料\\day11-SpringBootWeb案例\\资料\\03. 文件上传\\"+newFileName));

        return Result.success();
    }
```

#### 3）阿里云OSS

**依赖** 

```xml
        <dependency>
            <groupId>com.aliyun.oss</groupId>
            <artifactId>aliyun-sdk-oss</artifactId>
            <version>3.15.1</version>
        </dependency>
```

**配置文件**

```java
@Data
@Component
@ConfigurationProperties(prefix = "aliyun.oss")
public class AliOSSProperties {
    private String endpoint;
    private String accessKeyId;
    private String accessKeySecret;
    private String bucketName;
}
```

**工具类**

```java
@Component
public class AliOSSUtils {

    @Autowired
    private AliOSSProperties aliOSSProperties;

    /**
     * 实现上传图片到OSS
     */
    public String upload(MultipartFile file) throws IOException {

        String endpoint = aliOSSProperties.getEndpoint();
        String accessKeyId = aliOSSProperties.getAccessKeyId();
        String accessKeySecret = aliOSSProperties.getAccessKeySecret();
        String bucketName = aliOSSProperties.getBucketName();

        // 获取上传的文件的输入流
        InputStream inputStream = file.getInputStream();

        // 避免文件覆盖
        String originalFilename = file.getOriginalFilename();
        String fileName = UUID.randomUUID().toString() + originalFilename.substring(originalFilename.lastIndexOf("."));

        //上传文件到 OSS
        OSS ossClient = new OSSClientBuilder().build(endpoint, accessKeyId, accessKeySecret);
        ossClient.putObject(bucketName, fileName, inputStream);

        //文件访问路径
        String url = endpoint.split("//")[0] + "//" + bucketName + "." + endpoint.split("//")[1] + "/" + fileName;
        // 关闭ossClient
        ossClient.shutdown();
        return url;// 把上传到oss的路径返回
    }

}
```

**使用示例**

```java
@PostMapping("/upload")
    public Result upload( MultipartFile image) throws IOException {
        log.info("文件上传：{}", image.getOriginalFilename());

        //阿里云OSS工具类上传
        String url = aliOSSUtils.upload(image);

        log.info("文件上传完成，文件访问的url：{}",url);

        return Result.success(url);
    }
```

# 参考

[1] [https://blog.csdn.net/tianjiliuhen/article/details/126954490](https://blog.csdn.net/tianjiliuhen/article/details/126954490)
